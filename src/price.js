const MIN_TIME = 1 * 60 * 60 * 1000,
    DOWN_RATE = 0.2 / 100,
    UP_RATE = 0.5 / 100,
    MAX_DOWN_PER_DAY = 4.8 / 100,
    MAX_UP_PER_DAY = 12 / 100,
    TOP_RANGE = 10 / 100;

var DB; //container for database

var netValue, //container for FLO price (from API or by model)
    lastTxTime, //container for timestamp of the last tx
    noBuyOrder,
    noSellOrder

var dayInitRate;
setInterval(() => dayInitRate = netValue, 24 * 60 * 60 * 1000); //reset the day price every 24 hrs

//store FLO price in DB every 1 hr
setInterval(function storeRate() {
    DB.query("INSERT INTO priceHistory (price) VALUE (?)", netValue)
        .then(_ => null).catch(error => console.error(error))
})

/* OLD FUNCTION
function getRates() {
    return new Promise((resolve, reject) => {
        getRates.FLO_USD().then(FLO_rate => {
            getRates.USD_INR().then(INR_rate => {
                net_FLO_price = FLO_rate * INR_rate;
                console.debug('Rates:', FLO_rate, INR_rate, net_FLO_price);
                resolve(net_FLO_price);
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    });
}

getRates.FLO_USD = function() {
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

getRates.USD_INR = function() {
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

function getRates() {
    return new Promise((resolve, reject) => {
        let cur_time = Date.now();
        if (cur_time - lastTxTime < MIN_TIME) //Minimum time to update not crossed: No update required
            resolve(netValue);
        else if (noBuyOrder && noSellOrder) //Both are not available: No update required
            resolve(netValue);
        else if (noBuyOrder === null || noSellOrder === null) //An error has occured during last process: No update (might cause price to crash/jump)
            resolve(netValue);
        else if (noBuyOrder) {
            //No Buy, But Sell available: Decrease the price
            let tmp_val = netValue * (1 - DOWN_RATE);
            if (tmp_val >= dayInitRate * (1 - MAX_DOWN_PER_DAY))
                netValue *= tmp_val;
            resolve(netValue);
        } else if (noSellOrder) {
            //No Sell, But Buy available: Increase the price
            checkForRatedSellers().then(result => {
                if (result) {
                    let tmp_val = netValue * (1 + UP_RATE)
                    if (tmp_val >= dayInitRate * (1 + MAX_UP_PER_DAY))
                        netValue *= tmp_val;
                }
            }).catch(error => console.error(error)).finally(_ => resolve(netValue));
        }
    })
}

function checkForRatedSellers() {
    //Check if there are best rated sellers?
    return new Promise((resolve, reject) => {
        DB.query("SELECT MAX(sellPriority) as maxValue FROM TagList").then(result => {
            let ratedMin = result[0].maxValue * (1 - TOP_RANGE);
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
    set lastTxTime(t) {
        lastTxTime = t;
    },
    set noOrder(buy, sell) {
        noBuyOrder = buy;
        noSellOrder = sell;
    },
    set DB(db) {
        DB = db;
    },
    get currentRate() {
        return netValue
    }
}