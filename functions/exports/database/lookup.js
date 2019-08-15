exports.iexID = function(systemDatabase, symbol) {
  return new Promise((resolve, reject) => {

    let getIEXID = systemDatabase.child(`global/symbols`).orderByChild('symbol').equalTo(symbol).once('value');

    return getIEXID.then(results => {

      var iexID = null;

      results.forEach(id => {
        let val = id.val();
        iexID = val.iexId;
      });

      if (iexID === null) {
        return Promise.reject(new Error("IEXID not found."));
      }
      return resolve(iexID);
    }).catch(e => {
      console.log(e);
      return reject(e);
    });
  });
}