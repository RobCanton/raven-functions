const util = require('util');
const firebase = require('./exports/firebase/firebase.js');
const notifier = require('./exports/notifications/notificationsAPI.js');

firebase.initialize();

const functions = firebase.functions();
const admin = firebase.admin();
const database = firebase.database();
const systemDatabase = firebase.systemDatabase();
const firestore = firebase.firestore();

const rp = require("request-promise");


const BASE_URL = "https://cloud.iexapis.com/stable/";
const IEXCLOUD_APIKEY = "sk_4825f6ed09244b63b6d45191944fa25d";

function iexcloudRequestURI(route, params) {

  var paramsStr = `?token=${IEXCLOUD_APIKEY}`;
  if (params !== null) {
    for (var key in params) {
      paramsStr += `&${key}=${params[key]}`;
    }
  }


  return `${BASE_URL}${route}${paramsStr}`;
}

exports.search = functions.https.onCall((data, context) => {
  const uid = context.auth.uid;
  const query = data.query;

  let route = `search/${query}`;

  let uri = iexcloudRequestURI(route, {});

  var options = {
    uri: uri,
    json: true
  };
  
  return rp(options).then ( results => {
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

exports.addToWatchlist = functions.https.onCall((data, context) => {
  const uid = context.auth.uid;

  const symbol = data.symbol;

  var iexID = null;
  
  let lookup = require('./exports/database/lookup.js');


  let lookupIEXID = lookup.iexID(systemDatabase, symbol);

  var intraday = {};
  var intradayArray = [];
  return lookupIEXID.then( id => {
    
    iexID = id;
    
    let checkDatabase = database.child(`global/watchlist/${iexID}`).once('value');
    return checkDatabase;
    
  }).then(result => {

    if (result.val() === null) {
      let route = `stock/${symbol}/intraday-prices`;
      let params = {

      };

      let uri = iexcloudRequestURI(route, params);

      var options = {
        uri: uri,
        json: true
      };
      return rp(options);
    } else {
      let getIntraday = database.child(`global/intra-day/${iexID}`).once('value');
      return getIntaday.then( results => {
        if (results.exist()) {
          console.log("Exists: " + results.val());
        } else {
          console.log("Exists: false");
        }
        return Promise.resolve(null);
      })
    }

  }).then(results => {

    if (results === null) {
      console.log("EXISTS: true");
      return Promise.resolve(true);
    }
    
    console.log("EXISTS: false");
    var date = "";

    for (var i = 0; i < results.length; i++) {
      let result = results[i];
      date = result.date;
      let minute = result.minute;

      var intradayQuote = {
        average: result.average,
        close: result.close,
        open: result.open,
        high: result.high,
        low: result.low
      }

      intraday[minute] = intradayQuote;
      intradayArray.push(intradayQuote);
    }

    console.log("Intraday: " + intraday);
    let setIntraday = database.child(`global/intra-day/${iexID}/${date}`).set(intraday);
    return setIntraday;

  }).then(result => {
    if (result === null) {
      return {
        success: true,
        iexID: iexID,
        result: intradayArray
      }
    } else {
      return {
        success: true,
        result: {
          iexID: iexID,
          intraday: intradayArray
        }
      };
    }
  }).catch(error => {
    console.log(error);
    return {
      success: false,
      error: error
    };
  });


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

  let getGlobalWatchlist = database.child("global/watchlist").once('value');

  var userWatchlist = {};

  return getGlobalWatchlist.then(snapshot => {

    var symbolBatch = null;


    snapshot.forEach(security => {

      const split = security.key.split(":");
      const exchange = split[0];
      const symbol = split[1];

      if (symbolBatch === null) {
        symbolBatch = symbol;
      } else {
        symbolBatch += "," + symbol;
      }

      var userList = [];
      security.forEach(user => {
        userList.push(user.key);
      })

      userWatchlist[symbol] = userList;

    });
    console.log("Symbol batch: " + symbolBatch);

    if (symbolBatch !== null) {
      let filter = "&filter=change,changePercent,companyName,latestPrice,latestUpdate,symbol,latestSource"
      let params = `?symbols=${symbolBatch}&types=quote&token=${IEXCLOUD_APIKEY}${filter}`;
      let endpoint = `stock/market/batch`;
      let uri = `${BASE_URL}${endpoint}${params}`;

      var options = {
        uri: uri,
        json: true
      };

      return rp(options);
    } else {
      return Promise.resolve();
    }

  }).then(results => {
    console.log(results);

    var promises = [];

    var updateObject = {};

    for (var key in results) {
      updateObject[`${key}`] = results[key].quote;


      let usersList = userWatchlist[key];

      /*
      usersList.forEach(uid => {
        let title = "Stock Price Update";
        let body = `${price}`;
        let notifyUser = notifier.send(admin,
          database,
          uid,
          title,
          body);
        promises.push(notifyUser);
      });*/

    }
    let update = database.child("global/stocks").update(updateObject);

    promises.push(update);

    return Promise.all(promises);

  }).catch(e => {
    console.log("Error: " + e);
    return Promise.reject(e);
  })

});