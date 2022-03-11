'use strict';
//fetch for node js (used in floBlockchainAPI.js)
global.fetch = require("node-fetch");

global.convertDateToString = function(timestamp) {
    let date = new Date(timestamp);
    return date.getFullYear() + '-' +
        ('00' + (date.getMonth() + 1)).slice(-2) + '-' +
        ('00' + date.getDate()).slice(-2) + ' ' +
        ('00' + date.getHours()).slice(-2) + ':' +
        ('00' + date.getMinutes()).slice(-2) + ':' +
        ('00' + date.getSeconds()).slice(-2);
}

//Set browser paramaters from param.json (or param-default.json)
var param;
try {
    param = require('../args/param.json');
} catch {
    param = require('../args/param-default.json');
} finally {
    for (let p in param)
        global[p] = param[p];
}

/*
//Trace the debug logs in node js
var debug = console.debug;
console.debug = function() {
    debug.apply(console, arguments);
    console.trace();
};
*/