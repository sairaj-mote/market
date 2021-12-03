'use strict';

const MIN_TIME = 10 * 1000, // 1 * 60 * 60 * 1000,
    DOWN_RATE = 0.2 / 100,
    UP_RATE = 0.5 / 100,
    MAX_DOWN_PER_DAY = 4.8 / 100,
    MAX_UP_PER_DAY = 12 / 100,
    TOP_RANGE = 10 / 100,
    REC_HISTORY_INTERVAL = 5 * 60 * 1000; // 1 * 60 * 60 * 1000;

var DB; //container for database

var cur_rate, //container for FLO price (from API or by model)
    lastTime = Date.now(), //container for timestamp of the last tx
    noBuyOrder,
    noSellOrder;

const updateLastTime = () => lastTime = Date.now();

//store FLO price in DB every 1 hr
function storeRate(rate = cur_rate) {
    DB.query("INSERT INTO priceHistory (rate) VALUE (?)", rate)
        .then(_ => null).catch(error => console.error(error))
}
setInterval(storeRate, REC_HISTORY_INTERVAL)

function getPastRate(hrs = 24) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT rate FROM priceHistory WHERE rec_time >= NOW() - INTERVAL ? hour ORDER BY rec_time LIMIT 1", [hrs])
            .then(result => result.length ? resolve(result[0].rate) : reject('No records found in past 24hrs'))
            .catch(error => reject(error))
    });
}

function loadRate() {
    return new Promise((resolve, reject) => {
        if (typeof cur_rate !== "undefined")
            return resolve(cur_rate);
        DB.query("SELECT rate FROM priceHistory ORDER BY rec_time DESC LIMIT 1").then(result => {
            if (result.length)
                resolve(cur_rate = result[0].rate);
            else
                fetchRates().then(rate => resolve(cur_rate = rate)).catch(error => reject(error));
        }).catch(error => reject(error));
    })
}

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

function getRates() {
    return new Promise((resolve, reject) => {
        loadRate().then(_ => {
            let cur_time = Date.now();
            if (cur_time - lastTime < MIN_TIME) //Minimum time to update not crossed: No update required
                resolve(cur_rate);
            else if (noBuyOrder && noSellOrder) //Both are not available: No update required
                resolve(cur_rate);
            else if (noBuyOrder === null || noSellOrder === null) //An error has occured during last process: No update (might cause price to crash/jump)
                resolve(cur_rate);
            else
                getPastRate().then(ratePast24hr => {
                    if (noBuyOrder) {
                        //No Buy, But Sell available: Decrease the price
                        let tmp_val = cur_rate * (1 - DOWN_RATE);
                        if (tmp_val >= ratePast24hr * (1 - MAX_DOWN_PER_DAY)) {
                            cur_rate = tmp_val;
                            updateLastTime();
                        }
                        resolve(cur_rate);
                    } else if (noSellOrder) {
                        //No Sell, But Buy available: Increase the price
                        checkForRatedSellers().then(result => {
                            if (result) {
                                let tmp_val = cur_rate * (1 + UP_RATE);
                                if (tmp_val <= ratePast24hr * (1 + MAX_UP_PER_DAY)) {
                                    cur_rate = tmp_val;
                                    updateLastTime();
                                }
                            }
                        }).catch(error => console.error(error)).finally(_ => resolve(cur_rate));
                    }
                }).catch(error => {
                    console.error(error);
                    resolve(cur_rate);
                });
        }).catch(error => reject(error));
    })
}

function checkForRatedSellers() {
    //Check if there are best rated sellers?
    return new Promise((resolve, reject) => {
        DB.query("SELECT MAX(sellPriority) as max_p FROM TagList").then(result => {
            let ratedMin = result[0].max_p * (1 - TOP_RANGE);
            DB.query("SELECT COUNT(*) as value FROM SellOrder WHERE floID IN (" +
                " SELECT Tags.floID FROM Tags INNER JOIN TagList ON Tags.tag = TagList.tag" +
                " WHERE TagList.sellPriority > ?)", [ratedMin]).then(result => {
                resolve(result[0].value > 0);
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

module.exports = {
    getRates,
    updateLastTime,
    noOrder(buy, sell) {
        noBuyOrder = buy;
        noSellOrder = sell;
    },
    set DB(db) {
        DB = db;
    },
    get currentRate() {
        return cur_rate
    }
}