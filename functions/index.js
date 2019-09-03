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

exports.addToWatchlist = functions.https.onCall((data, context) => {
  const uid = context.auth.uid;

  const symbol = data.symbol;

  var iexID = null;

  var intradayArray = [];

  let lookupIEXID = require('./exports/lookup/lookupIEXID.js');
  let lookupIEXIDWithSymbol = lookupIEXID.withSymbol(symbol, systemDatabase);

  let currentDateStr = utilties.formatDate(new Date());

  return lookupIEXIDWithSymbol.then( id => {
    iexID = id;

    let checkActivity = database.child(`global/active/${iexID}`).once('value');
    return checkActivity;

  }).then( activitySnapshot => {
    if (activitySnapshot.exists()) {
      return Promise.resolve(null);
    }
    let setActive = database.child(`global/active/${iexID}`).set(true);
    return setActive;

  }).then( result => {

    if (result !== null) {

      var date = "";

      var intradayObject = {};
      return iexCloudAPI.stockIntradayPrices(symbol).then ( intradayResults => {

        for (var i = 0; i < intradayResults.length; i++) {
          let result = intradayResults[i];
          date = result.date;
          let minute = result.minute;
          var price = -1;
          if (result.average) {
            price = result.average;
          } else if (result.marketAverage) {
            price = result.marketAverage;
          }
          var intradayQuote = {
            price: price,
            minute: minute
          }

          intradayObject[minute] = intradayQuote;
          intradayArray.push(intradayQuote);
        }

        let quoteParams = {
          filter:`change,changePercent,companyName,latestPrice,latestUpdate,symbol,latestSource`
        };

        return iexCloudAPI.stockQuote(symbol, quoteParams);

      }).then( latestQuote => {
        console.log("latestQuote:");
        let latestUpdate = latestQuote.latestUpdate;
        let minute = utilties.formatDateHHMM(utilties.ConvertUTCTimeToLocalTime(latestUpdate));

        var intradayQuote = {
          price: latestQuote.latestPrice,
          minute: minute,
          latestUpdate: latestUpdate,
          change: latestQuote.change,
          changePercent: latestQuote.changePercent
        }

        console.log("Minute: " + minute);
        console.log(util.inspect(latestQuote, false, null, true));

        intradayObject[minute] = intradayQuote;
        intradayArray.push(intradayQuote);

        let setIntraday = database.child(`global/intra-day/${iexID}`).set(intradayObject);
        return setIntraday;
      }).then (() => {
        return Promise.resolve()
      });
    } else {
      let getIntraday = database.child(`global/intra-day/${iexID}`).orderByKey().once('value');
      return getIntraday.then ( intradaySnapshot => {

        intradaySnapshot.forEach( quote => {
          intradayArray.push(quote.val());
        });

        return Promise.resolve();

      });

    }

  }).then( () => {
    console.log("Intraday Array: " + intradayArray);
    let updateObject = {};
    updateObject[`global/watchlist/${iexID}/${uid}`] = true;
    updateObject[`user/watchlist/${uid}/${iexID}`] = true;

    let update = database.update(updateObject);
    return update;
  }).then( () => {
    return {
      success: true,
      iexID: iexID,
      intradayArray: intradayArray
    }
  }).catch( e => {
    console.log(e);
    return {
      success: false,
      error: e
    }
  })

});

exports.removeFromWatchlist = functions.https.onCall((data, context) => {
  console.log("deleteAlert");

  const uid = context.auth.uid;
  let iexID = data.iexID;

  if (iexID === undefined) {
    console.log("Throw error!");
    throw new functions.https.HttpsError(400, 'invalid-argument', 'Arguments invalid or missing: iexID');
  }

  var updateObject = {};
  updateObject[`global/watchlist/${iexID}/${uid}`] = null;
  updateObject[`user/watchlist/${uid}/${iexID}`] = null;
  updateObject[`user/alerts/${uid}/${iexID}`] = null;

  return database.update(updateObject).then ( () => {
    return {
      success: true
    }
  }).catch( e => {
    console.log(e);
    throw new functions.https.HttpsError(500, 'internal-server-error', 'An internal server error has occurred.');
  });

});

exports.exchanges = functions.https.onRequest((req, res) => {
  console.log("Exchanges!");

  return iexCloudAPI.refUSExchanges().then( results => {

    var object = {};

    results.forEach( exchange => {
      let refId = exchange.refId;
      let name = exchange.name;
      let longName = exchange.longName;
      let mic = exchange.mic;

      if (refId && name && longName && mic) {
        let exchangeData = {
          name: exchange.name,
          longName: longName,
          mic: exchange.mic
        }
        object[refId] = exchangeData;
      }

    })

    let ref = systemDatabase.child(`ref/exchanges/us`);
    return ref.update(object);

  }).then( () => {
    return res.send({
      success: true
    })
  }).catch( e => {
    console.log(e);
    return res.send({
      success: false,
      error: e
    })
  })
});

exports.updateExchanges = functions.pubsub.schedule('every day 18:24').timeZone('America/New_York').onRun((context) => {
  let params = `?token=${IEXCLOUD_APIKEY}`;
  let endpoint = `ref-data/exchanges`;
  let uri = `${BASE_URL}${endpoint}${params}`;

  var options = {
    uri: uri,
    json: true
  };

  return rp(options).then(results => {

    var updateObject = {};
    results.forEach(exchangeObj => {
      let key = exchangeObj.exchange;
      updateObject[key] = exchangeObj;
    });

    let updateRequest = systemDatabase.child("global/exchanges").update(updateObject);
    return updateRequest;
  }).then(() => {
    let params = `?token=${IEXCLOUD_APIKEY}`;
    let endpoint = `ref-data/symbols`;
    let uri = `${BASE_URL}${endpoint}${params}`;

    var options = {
      uri: uri,
      json: true
    };
    return rp(options);
  }).then(results => {
    console.log("all symbols: ", results);

    var updateObject = {};
    results.forEach(symbolObj => {
      let key = symbolObj.iexId;
      updateObject[key] = symbolObj;
    });

    let updateRequest = systemDatabase.child("global/symbols").update(updateObject);
    return updateRequest
  }).catch(e => {
    return Promise.reject(e);
  })
});


exports.priceUpdater = functions.pubsub.schedule('every 1 minutes').onRun((context) => {
  console.log('This will be run every 1 minutes!');

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
