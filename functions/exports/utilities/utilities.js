
exports.formatDate = function(d) {
    var month = '' + (d.getMonth() + 1),
        day = '' + d.getDate(),
        year = d.getFullYear();

    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;

    return [year, month, day].join('-');
}

exports.formatDateHHMM = function(d) {
    var localeSpecificTime = d.toLocaleTimeString();
    return localeSpecificTime.replace(/:\d+ /, ' ').slice(0, -3);
}

exports.ConvertUTCTimeToLocalTime = function(UTCDateString) {
    var convertdLocalTime = new Date(UTCDateString);
    convertdLocalTime.setHours( convertdLocalTime.getHours() - 4 );
    return convertdLocalTime;
}
