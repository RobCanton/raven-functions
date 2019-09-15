const util = require('util');
const rp = require('request-promise');
const constants = require('./exports/constants.js');
const iexCloudAPI = require('./exports/iexCloud/iexCloudAPI.js');
const firebase = require('./exports/firebase/firebase.js');
const notifier = require('./exports/notifications/notificationsAPI.js');
const utilties = require('./exports/utilities/utilities.js');

firebase.initialize();

const functions = firebase.functions();
const admin = firebase.admin();
const database = firebase.database();
const systemDatabase = firebase.systemDatabase();
const firestore = firebase.firestore();

iexCloudAPI.setAPIKey(functions.config().iexcloud.key);

exports.search = functions.https.onCall((data, context) => {

  const query = data.query;

  return iexCloudAPI.stockSearch(query).then ( results => {
    console.log("Results: " + results);
    return {
      success: true,
      results: results
    }
  }).catch( e => {
    console.log(e);
    return {
      success: false
    }
  });
});

exports.addAlert = functions.https.onCall((data, context) => {
  const uid = context.auth.uid;
  const iexID = data.iexID;
  var alertData = data.alertData;

  alertData.dateCreated = Date.now();

  let addAlertRef = database.child(`user/alerts/${uid}/${iexID}`).push();
  let alertKey = addAlertRef.key;

  return addAlertRef.set(alertData).then( () => {

    var responseData = alertData;
    responseData.iexID = iexID;
    responseData.id = alertKey;

    return responseData;
  }).catch (e => {
    console.log(e);
    return {
      success: false,
      error: e
    }
  })


});

exports.updateAlert = functions.https.onCall((data, context) => {

});

exports.deleteAlert = functions.https.onCall((data, context) => {
  console.log("deleteAlert");

  const uid = context.auth.uid;
  let id = data.id;
  let iexID = data.iexID;

  if (id === undefined || iexID === undefined) {
    console.log("Throw error!");
    throw new functions.https.HttpsError(400, 'invalid-argument', 'Arguments invalid or missing: id, iexID');
  }

  let alertRef = database.child(`user/alerts/${uid}/${iexID}/${id}`);

  return alertRef.remove().then( () => {
    return {
      success: true
    }
  }).catch( e => {
    console.log(e);
    throw new functions.https.HttpsError(500, 'internal-server-error', 'An internal server error has occurred.');
  });

});


exports.priceUpdater = functions.pubsub.schedule('every 48 hours').onRun((context) => {
  //console.log('This will be run every 1 minutes!');

  let lookupSymbol = require('./exports/lookup/lookupSymbol.js');

  let getGlobalWatchlist = database.child('global/watchlist').once('value');

  let currentDateStr = utilties.formatDate(new Date());

  var userWatchlist = {};
  var symbolMap = {};
  var iexIDMap = {};
  var quotes = {};

  return getGlobalWatchlist.then(snapshot => {

    var promises = [];
    snapshot.forEach( security => {
      let iexID = security.key;
      let lookupSymbolWithIEXID = lookupSymbol.withIEXID(iexID, systemDatabase);
      promises.push(lookupSymbolWithIEXID);


      var userList = [];
      security.forEach( user => {
        userList.push(user.key);
      })
      userWatchlist[iexID] = userList;
    });

    return Promise.all(promises);

  }).then( results => {

    var symbolBatch = null;

    for (var i = 0; i < results.length; i++) {

      let result = results[i];
      let iexID = result.iexID;
      let symbol = result.symbol;

      symbolMap[symbol] = iexID;
      iexIDMap[iexID] = symbol;

      if (symbolBatch === null) {
        symbolBatch = symbol;
      } else {
        symbolBatch += "," + symbol;
      }

    }

    if (symbolBatch !== null) {

      let params = {
        symbols: symbolBatch,
        types: "quote",
        filter: "change,changePercent,companyName,latestPrice,latestUpdate,symbol,latestSource"
      }
      return iexCloudAPI.stockBatch(params);
    }

    return Promise.resolve();
  }).then( results => {

    var promises = [];

    var updateObject = {};

    for (var key in results) {
      let quote = results[key].quote;
      let iexID = symbolMap[key];
      let latestUpdate = quote.latestUpdate;
      let latestUpdateFormatted = utilties.formatDate(new Date(latestUpdate));
      let minute = utilties.formatDateHHMM(utilties.ConvertUTCTimeToLocalTime(latestUpdate));

      let usersList = userWatchlist[key];

      console.log(`${key} { ${minute} : ${quote.latestPrice} }`);
      var quoteObject = {
        price: quote.latestPrice,
        change: quote.change,
        changePercent: quote.changePercent,
        minute: minute,
        latestUpdate: latestUpdate
      }

      quotes[iexID] = quoteObject;

      console.log("latestUpdateFormatted: " + latestUpdateFormatted);
      updateObject[`global/intra-day/${iexID}/${latestUpdateFormatted}/${minute}`] = quoteObject;

    }

    return database.update(updateObject);

  }).then ( () => {

    var userAlertsPromises = [];

    for (var iexID in userWatchlist) {
      var userList = userWatchlist[iexID];
      userList.forEach( uid => {
        //console.log(`Fetch user alerts for ${uid}: ${iexID}`);
        let fetchUserAlertsForIEXID = database.child(`user/alerts/${uid}/${iexID}`).once('value');
        userAlertsPromises.push(fetchUserAlertsForIEXID);
      })
    }
    return Promise.all(userAlertsPromises);

  }).then( results => {

    var updateObject = {};

    results.forEach( alerts => {
      if (alerts.exists()) {
        let uid = alerts.ref.parent.key;
        let iexID = alerts.key;
        let quote = quotes[iexID];

        if (quote) {
          alerts.forEach( alert => {
            // If alert is triggered
            let alertData = alert.val();
            let alertType = alertData.type;

            let notificationObject = {
              alertID: alert.key,
              iexID: iexID,
              alert: alertData
            };

            let notificationID = `ALERT:${alert.key}`;

            switch(alertType) {
              case constants.alertType.price: {
                console.log("Price Alert:");

                let triggerPrice = alertData.price;
                let condition = alertData.condition;

                switch (condition) {
                  case constants.priceAlertConditions.isOver:
                  if (quote.price > triggerPrice) {
                    console.log(`Price > Trigger: ${quote.price} > ${triggerPrice}`);
                    updateObject[`user/notifications/${uid}/${notificationID}`] = notificationObject;
                  }
                  break
                  case constants.priceAlertConditions.isUnder:
                  if (quote.price < triggerPrice) {
                    console.log(`Price < Trigger: ${quote.price} < ${triggerPrice}`);
                    updateObject[`user/notifications/${uid}/${notificationID}`] = notificationObject;
                  }
                  break
                }
                break
              }
              case constants.alertType.dpm: {
                console.log("DPM Alert:");
                let triggerPercent = alertData.percentChange ;
                let condition = alertData.condition;
                let changePercent = quote.changePercent * 100;
                console.log("CHANGE PERCENT: " + changePercent);
                switch(condition) {
                  case constants.dpmAlertConditions.isStockUpBy:
                  if (changePercent >= triggerPercent) {
                    console.log(`UP - ChangePercent > Trigger: ${changePercent}% > ${triggerPercent}%`);
                    updateObject[`user/notifications/${uid}/${notificationID}`] = notificationObject;
                  }
                  break
                  case constants.dpmAlertConditions.isStockDownBy:
                  if (changePercent <= triggerPercent * -1) {
                    console.log(`DOWN - ChangePercent > Trigger: ${changePercent}% > ${triggerPercent * -1}%`);
                    updateObject[`user/notifications/${uid}/${notificationID}`] = notificationObject;
                  }
                  break
                }
                break
              }
              case constants.alertType.tsp:
              console.log("TSP Alert: " + alertData);
              break
            default:
              break
            }
          });
        }

      }

    });

    return database.update(updateObject);
  }).catch(e => {
    console.log("Error: " + e);
    return Promise.reject(e);
  })

});

exports.deliverNotification = functions.database.ref('app/user/notifications/{uid}/{notificationID}').onCreate((snapshot, context) => {
  let uid = context.params.uid;
  let notificationID = context.params.notificationID;

  let price = snapshot.val().alert.price;
  var promises = [];
  console.log("PRICE: " + price);
  let title = `ATVI Alert`;
  let body = `ATVI is above ${price}`;
  let notifyUser = notifier.send(admin,
    database,
    uid,
    title,
    body);

  promises.push(notifyUser);


  return Promise.all(promises);
});


// Exchange
exports.createExchange = functions.firestore.document('exchanges/{id}').onCreate((change, context) => {
  const newValue = snap.data();

  let exchangeID = newValue.exchangeID;
  let region = newValue.region;

  let uri = `http://replicode.io:3000/ref-data/exchange/${region}/${exchangeID}`;
  var options = {
    method: 'POST',
    uri: uri,
    body: newValue,
    json: true
  };

  return rp(options).then( results => {
    console.log(results);
    return Promise.resolve(results);
  }).catch( err => {
    console.log(err);
    return Promise.reject(err);
  })
});

exports.updateExchange = functions.firestore.document('exchanges/{id}').onUpdate((change, context) => {
  const newValue = change.after.data();

  let exchangeID = newValue.exchangeID;
  let region = newValue.region;

  let uri = `http://replicode.io:3000/ref-data/exchange/${region}/${exchangeID}`;
  var options = {
    method: 'POST',
    uri: uri,
    body: newValue,
    json: true
  };

  return rp(options).then( results => {
    console.log(results);
    return Promise.resolve(results);
  }).catch( err => {
    console.log(err);
    return Promise.reject(err);
  })
});

exports.deleteExchange = functions.firestore.document('exchanges/{id}').onDelete((snap, context) => {

  const deletedValue = snap.data();
  let exchangeID = deletedValue.exchangeID;
  let region = deletedValue.region;

  let uri = `http://replicode.io:3000/ref-data/exchange/${region}/${exchangeID}`;
  var options = {
    method: 'DELETE',
    uri: uri,
    json: true
  };

  return rp(options).then( results => {
    console.log(results);
    return Promise.resolve(results);
  }).catch( err => {
    console.log(err);
    return Promise.reject(err);
  })

});


// Timezone
exports.createTimezone = functions.firestore.document('timezones/{id}').onCreate((snap, context) => {
  const newValue = snap.data();

  let timezone = newValue.timezone;

  let uri = `http://replicode.io:3000/timezone/${timezone}`;
  var options = {
    method: 'POST',
    uri: uri,
    body: newValue,
    json: true
  };

  return rp(options).then( results => {
    console.log(results);
    return Promise.resolve(results);
  }).catch( err => {
    console.log(err);
    return Promise.reject(err);
  })

});

exports.updateTimezone = functions.firestore.document('timezones/{id}').onUpdate((change, context) => {
  const newValue = change.after.data();

  let timezone = newValue.timezone;

  let uri = `http://replicode.io:3000/timezone/${timezone}`;
  var options = {
    method: 'POST',
    uri: uri,
    body: newValue,
    json: true
  };

  return rp(options).then( results => {
    console.log(results);
    return Promise.resolve(results);
  }).catch( err => {
    console.log(err);
    return Promise.reject(err);
  })
});

exports.deleteExchange = functions.firestore.document('timezones/{id}').onDelete((snap, context) => {

  const deletedValue = snap.data();
  let timezone = deletedValue.timezone;

  let uri = `http://replicode.io:3000/timezone/${timezone}`;
  var options = {
    method: 'DELETE',
    uri: uri,
    json: true
  };

  return rp(options).then( results => {
    console.log(results);
    return Promise.resolve(results);
  }).catch( err => {
    console.log(err);
    return Promise.reject(err);
  })

});
