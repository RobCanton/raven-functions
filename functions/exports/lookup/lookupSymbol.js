exports.withIEXID = function(iexID, systemDatabase) {
  return new Promise((resolve, reject) => {

    let getSymbol = systemDatabase.child(`global/symbols/${iexID}`).once('value');

    return getSymbol.then(results => {

      if (results.exists()) {
        return resolve({
          iexID: iexID,
          symbol: results.val().symbol
        });
      } else {
        return Promise.reject(new Error("Symnol not found."));
      }

    }).catch(e => {
      console.log(e);
      return reject(e);
    });
  });
}
