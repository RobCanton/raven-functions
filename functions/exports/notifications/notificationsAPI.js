exports.send = function(admin, database, uid, title, body) {
  return new Promise((resolve, reject) => {

    console.log("SEND notification to " + uid);
    let fetchUserFCMTokens = database.child("fcmTokens").orderByValue().equalTo(uid).once("value");
    return fetchUserFCMTokens.then(tokens => {

      var promises = [];

      let payload = {
        "notification": {
          "title": title,
          "body": body,
          "badge": `0`
        }
      }

      tokens.forEach(token => {
        const sendPushNotification = admin.messaging().sendToDevice(token.key, payload);
        promises.push(sendPushNotification);
      });

      return Promise.all(promises);

    }).then(() => {
      return resolve();
    }).catch(error => {
      console.log("Error: ", error);
      return reject(error);
    });
  });
}