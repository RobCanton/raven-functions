const rp = require('request-promise');

var apiKey;

exports.setAPIKey = function(key) {
  apiKey = key;
}


function iexcloudRequestURI(route, params) {

  let baseURL = "https://cloud.iexapis.com/stable/";
  var paramsStr = `?token=${apiKey}`;
  if (params !== null) {
    for (var key in params) {
      paramsStr += `&${key}=${params[key]}`;
    }
  }

  return `${baseURL}${route}${paramsStr}`;
}

// STOCKS

exports.stockSearch = function(query) {
  let route = `search/${query}`;

  let uri = iexcloudRequestURI(route, {});

  var options = {
    uri: uri,
    json: true
  };

  return rp(options);
}
exports.stockBatch = function(params) {
  let route = `stock/market/batch`;

  let uri = iexcloudRequestURI(route, params);

  let options = {
    uri: uri,
    json: true
  };

  return rp(options);
}

exports.stockQuote = function(symbol, params) {
  let route = `stock/${symbol}/quote`;

  let uri = iexcloudRequestURI(route, params);

  let options = {
    uri: uri,
    json: true
  };

  return rp(options);
}


exports.stockIntradayPrices = function(symbol) {
  let route = `stock/${symbol}/intraday-prices`;
  let params = {};

  let uri = iexcloudRequestURI(route, params);

  let options = {
    uri: uri,
    json: true
  };

  return rp(options);
}

// REFERENCE DATA
// Weight: 1
exports.refUSExchanges = function() {
  let route = `ref-data/market/us/exchanges`;
  let params = {};

  let uri = iexcloudRequestURI(route, params);

  let options = {
    uri: uri,
    json: true
  };

  return rp(options);
}
