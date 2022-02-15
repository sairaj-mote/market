'use strict';

const MIN_TIME = 10 * 1000, // 1 * 60 * 60 * 1000,
    DOWN_RATE = 0.2 / 100,
    UP_RATE = 0.5 / 100,
    MAX_DOWN_PER_DAY = 4.8 / 100,
    MAX_UP_PER_DAY = 12 / 100,
    TOP_RANGE = 10 / 100,
    REC_HISTORY_INTERVAL = 5 * 60 * 1000; // 1 * 60 * 60 * 1000;

var DB; //container for database

var currentRate = {}, //container for FLO price (from API or by model)
    lastTime = {}, //container for timestamp of the last tx
    noBuyOrder = {},
    noSellOrder = {};

const updateLastTime = asset => lastTime[asset] = Date.now();

//store FLO price in DB every 1 hr
function storeRate(asset, rate) {
    DB.query("INSERT INTO PriceHistory (asset, rate) VALUE (?, ?)", [asset, rate.toFixed(3)])
        .then(_ => null).catch(error => console.error(error))
}
setInterval(() => {
    for (let asset in currentRate)
        storeRate(asset, currentRate[asset]);
}, REC_HISTORY_INTERVAL)

function getPastRate(asset, hrs = 24) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT rate FROM PriceHistory WHERE asset=? AND rec_time >= NOW() - INTERVAL ? hour ORDER BY rec_time LIMIT 1", [asset, hrs])
            .then(result => result.length ? resolve(result[0].rate) : reject('No records found in past 24hrs'))
            .catch(error => reject(error))
    });
}

function loadRate(asset) {
    return new Promise((resolve, reject) => {
        if (typeof currentRate[asset] !== "undefined")
            return resolve(currentRate[asset]);
        updateLastTime(asset);
        DB.query("SELECT rate FROM PriceHistory WHERE asset=? ORDER BY rec_time DESC LIMIT 1", [asset]).then(result => {
            if (result.length)
                resolve(currentRate[asset] = result[0].rate);
            else
                DB.query("SELECT initialPrice FROM AssetList WHERE asset=?", [asset])
                .then(result => resolve(currentRate[asset] = result[0].initialPrice))
                .catch(error => reject(error))
        }).catch(error => reject(error));
    })
}

/*
function fetchRates() {
    return new Promise((resolve, reject) => {
        fetchRates.FLO_USD().then(FLO_rate => {
            fetchRates.USD_INR().then(INR_rate => {
                let FLO_INR_rate = FLO_rate * INR_rate;
                console.debug('Rates:', FLO_rate, INR_rate, FLO_INR_rate);
                storeRate(FLO_INR_rate);
                resolve(FLO_INR_rate);
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    });
}

fetchRates.FLO_USD = function() {
    return new Promise((resolve, reject) => {
        fetch('https://api.coinlore.net/api/ticker/?id=67').then(response => {
            if (response.ok) {
                response.json()
                    .then(result => resolve(result[0].price_usd))
                    .catch(error => reject(error));
            } else
                reject(response.status);
        }).catch(error => reject(error));
    });
}

fetchRates.USD_INR = function() {
    return new Promise((resolve, reject) => {
        fetch('https://api.exchangerate-api.com/v4/latest/usd').then(response => {
            if (response.ok) {
                response.json()
                    .then(result => resolve(result.rates['INR']))
                    .catch(error => reject(error));
            } else
                reject(response.status);
        }).catch(error => reject(error));
    });
}
*/

function getRates(asset) {
    return new Promise((resolve, reject) => {
        loadRate(asset).then(_ => {
            console.debug(asset, currentRate[asset]);
            let cur_time = Date.now();
            if (cur_time - lastTime[asset] < MIN_TIME) //Minimum time to update not crossed: No update required
                resolve(currentRate[asset]);
            else if (noBuyOrder[asset] && noSellOrder[asset]) //Both are not available: No update required
                resolve(currentRate[asset]);
            else if (noBuyOrder[asset] === null || noSellOrder[asset] === null) //An error has occured during last process: No update (might cause price to crash/jump)
                resolve(currentRate[asset]);
            else
                getPastRate(asset).then(ratePast24hr => {
                    if (noBuyOrder[asset]) {
                        //No Buy, But Sell available: Decrease the price
                        let tmp_val = currentRate[asset] * (1 - DOWN_RATE);
                        if (tmp_val >= ratePast24hr * (1 - MAX_DOWN_PER_DAY)) {
                            currentRate[asset] = tmp_val;
                            updateLastTime(asset);
                        } else
                            console.debug("Max Price down for the day has reached");
                        resolve(currentRate[asset]);
                    } else if (noSellOrder[asset]) {
                        //No Sell, But Buy available: Increase the price
                        checkForRatedSellers(asset).then(result => {
                            if (result) {
                                let tmp_val = currentRate[asset] * (1 + UP_RATE);
                                if (tmp_val <= ratePast24hr * (1 + MAX_UP_PER_DAY)) {
                                    currentRate[asset] = tmp_val;
                                    updateLastTime(asset);
                                } else
                                    console.debug("Max Price up for the day has reached");
                            }
                        }).catch(error => console.error(error)).finally(_ => resolve(currentRate[asset]));
                    }
                }).catch(error => {
                    console.error(error);
                    resolve(currentRate[asset]);
                });
        }).catch(error => reject(error));
    })
}

function checkForRatedSellers(asset) {
    //Check if there are best rated sellers?
    return new Promise((resolve, reject) => {
        DB.query("SELECT MAX(sellPriority) as max_p FROM TagList").then(result => {
            let ratedMin = result[0].max_p * (1 - TOP_RANGE);
            DB.query("SELECT COUNT(*) as value FROM SellOrder WHERE floID IN (" +
                " SELECT UserTag.floID FROM UserTag INNER JOIN TagList ON UserTag.tag = TagList.tag" +
                " WHERE TagList.sellPriority > ?) AND asset=?", [ratedMin, asset]).then(result => {
                resolve(result[0].value > 0);
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

module.exports = {
    getRates,
    updateLastTime,
    noOrder(asset, buy, sell) {
        noBuyOrder[asset] = buy;
        noSellOrder[asset] = sell;
    },
    set DB(db) {
        DB = db;
    },
    get currentRates() {
        return Object.assign({}, currentRate);
    }
}