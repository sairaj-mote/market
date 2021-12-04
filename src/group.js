'use strict';

var DB; //container for database

function addTag(floID, tag) {
    return new Promise((resolve, reject) => {
        DB.query("INSERT INTO Tags (floID, tag) VALUE (?,?)", [floID, tag])
            .then(result => resolve(`Added ${floID} to ${tag}`))
            .catch(error => {
                if (error.code === "ER_DUP_ENTRY")
                    reject(INVALID(`${floID} already in ${tag}`));
                else if (error.code === "ER_NO_REFERENCED_ROW")
                    reject(INVALID(`Invalid user-floID and/or Tag`));
                else
                    reject(error);
            });
    });
}

function removeTag(floID, tag) {
    return new Promise((resolve, reject) => {
        DB.query("DELETE FROM Tags WHERE floID=? AND tag=?", [floID, tag])
            .then(result => resolve(`Removed ${floID} from ${tag}`))
            .catch(error => reject(error));
    })
}

function getBestPairs(currentRate) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT tag, sellPriority, buyPriority FROM TagList").then(result => {
            //Sorted in Ascending (ie, stack; pop for highest)
            let tags_buy = result.sort((a, b) => a.buyPriority > b.buyPriority ? 1 : -1).map(r => r.tag);
            let tags_sell = result.sort((a, b) => a.sellPriority > b.sellPriority ? 1 : -1).map(r => r.tag);
            resolve(new bestPair(currentRate, tags_buy, tags_sell));
        }).catch(error => reject(error))
    })
}

const bestPair = function(cur_rate, tags_buy, tags_sell) {
    const currentRate = cur_rate;

    Object.defineProperty(this, 'cur_rate', {
        get: () => currentRate
    });

    this.get = () => new Promise((resolve, reject) => {
        Promise.allSettled([getBuyOrder(), getSellOrder()]).then(results => {
            if (results[0].status === "fulfilled" && results[1].status === "fulfilled")
                resolve({
                    buyOrder: results[0].value,
                    sellOrder: results[1].value,
                    null_base: getSellOrder.cache.mode_null
                })
            else
                reject({
                    buy: results[0].reason,
                    sell: results[1].reason
                })
        }).catch(error => reject(error))
    });

    this.next = (tx_quantity, incomplete_sell, flag_sell) => {
        let buy = getBuyOrder.cache,
            sell = getSellOrder.cache;
        if (buy.cur_order && sell.cur_order) {
            //buy order
            if (tx_quantity < buy.cur_order.quantity)
                buy.cur_order.quantity -= tx_quantity;
            else if (tx_quantity == buy.cur_order.quantity)
                buy.cur_order = null;
            else
                throw Error("Tx quantity cannot be more than order quantity");
            //sell order
            if (tx_quantity < sell.cur_order.quantity) {
                sell.cur_order.quantity -= tx_quantity;
                if (incomplete_sell) {
                    if (!sell.mode_null && flag_sell)
                        sell.null_queue.push(sell.cur_order);
                    sell.cur_order = null;
                }
            } else if (tx_quantity == sell.cur_order.quantity)
                sell.cur_order = null;
            else
                throw Error("Tx quantity cannot be more than order quantity");
        } else
            throw Error("No current order found");
    };

    const getSellOrder = () => new Promise((resolve, reject) => {
        let cache = getSellOrder.cache;
        if (cache.cur_order) { //If cache already has a pending order
            verifySellOrder(cache.cur_order, currentRate, cache.mode_null).then(result => {
                cache.cur_order = result;
                resolve(result);
            }).catch(error => {
                if (error !== false)
                    return reject(error);
                //Order not valid (minimum gain)
                cache.cur_order = null;
                getSellOrder()
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            })
        } else if (cache.orders && cache.orders.length) { //If cache already has orders in priority
            getTopValidSellOrder(cache.orders, currentRate, cache.mode_null).then(result => {
                cache.cur_order = result;
                resolve(result);
            }).catch(error => {
                if (error !== false)
                    return reject(error);
                //No valid order found in current tag
                cache.orders = null;
                getSellOrder()
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            })
        } else if (cache.tags.length) { //If cache has remaining tags
            cache.cur_tag = cache.tags.pop();
            getSellOrdersInTag(cache.cur_tag, currentRate).then(orders => {
                cache.orders = orders;
                getSellOrder()
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            }).catch(error => reject(error));
        } else if (!cache.end) { //Un-tagged floID's orders  (do only once)
            getUntaggedSellOrders(currentRate).then(orders => {
                cache.orders = orders;
                cache.cur_tag = null;
                cache.end = true;
                getSellOrder()
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            }).catch(error => reject(error));
        } else if (!cache.mode_null) { //Lowest priority Coins (FLO Brought from other sources)
            cache.orders = cache.null_queue.reverse(); //Reverse it so that we can pop the highest priority
            cache.mode_null = true;
            cache.null_queue = null;
            getSellOrder()
                .then(result => resolve(result))
                .catch(error => reject(error))
        } else
            reject(false);
    });
    getSellOrder.cache = {
        tags: tags_sell,
        null_queue: [],
        mode_null: false
    };

    const getBuyOrder = () => new Promise((resolve, reject) => {
        let cache = getBuyOrder.cache;
        if (cache.cur_order) { //If cache already has a pending order
            verifyBuyOrder(cache.cur_order, currentRate).then(result => {
                cache.cur_order = result;
                resolve(result);
            }).catch(error => {
                if (error !== false)
                    return reject(error);
                //Order not valid (cash not available)
                cache.cur_order = null;
                getBuyOrder()
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            })
        } else if (cache.orders && cache.orders.length) { //If cache already has orders in priority
            getTopValidBuyOrder(cache.orders, currentRate).then(result => {
                cache.cur_order = result;
                resolve(result);
            }).catch(error => {
                if (error !== false)
                    return reject(error);
                //No valid order found in current tag
                cache.orders = null;
                getBuyOrder()
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            })
        } else if (cache.tags.length) { //If cache has remaining tags
            cache.cur_tag = cache.tags.pop();
            getBuyOrdersInTag(cache.cur_tag, currentRate).then(orders => {
                cache.orders = orders;
                getBuyOrder()
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            }).catch(error => reject(error));
        } else if (!cache.end) { //Un-tagged floID's orders  (do only once)
            getUntaggedBuyOrders(currentRate).then(orders => {
                cache.orders = orders;
                cache.cur_tag = null;
                cache.end = true;
                getBuyOrder()
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            }).catch(error => reject(error));
        } else
            reject(false);
    });
    getBuyOrder.cache = {
        tags: tags_buy
    };
}

function getUntaggedSellOrders(cur_price) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT SellOrder.id, SellOrder.floID, SellOrder.quantity FROM SellOrder" +
                " LEFT JOIN Tags ON Tags.floID = SellOrder.floID" +
                " WHERE Tags.floID IS NULL AND SellOrder.minPrice <=? ORDER BY SellOrder.time_placed DESC", [cur_price])
            .then(orders => resolve(orders))
            .catch(error => reject(error))
    })
}

function getUntaggedBuyOrders(cur_price) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT BuyOrder.id, BuyOrder.floID, BuyOrder.quantity FROM BuyOrder" +
                " LEFT JOIN Tags ON Tags.floID = BuyOrder.floID" +
                " WHERE Tags.floID IS NULL AND BuyOrder.maxPrice >=? ORDER BY BuyOrder.time_placed DESC", [cur_price])
            .then(orders => resolve(orders))
            .catch(error => reject(error))
    })
}

function getSellOrdersInTag(tag, cur_price) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT SellOrder.id, SellOrder.floID, SellOrder.quantity FROM SellOrder" +
            " INNER JOIN Tags ON Tags.floID = SellOrder.floID" +
            " WHERE Tags.tag = ? AND SellOrder.minPrice <=? ORDER BY SellOrder.time_placed DESC", [tag, cur_price]).then(orders => {
            if (orders.length <= 1) // No (or) Only-one order, hence priority sort not required.
                resolve(orders);
            else
                getPointsFromAPI(tag, orders.map(o => o.floID)).then(points => {
                    let orders_sorted = orders.map(o => [o, points[o.floID]])
                        .sort((a, b) => a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0) //sort by points (ascending)
                        .map(x => x[0]);
                    resolve(orders_sorted);
                }).catch(error => reject(error))
        }).catch(error => reject(error))
    });
}

function getBuyOrdersInTag(tag, cur_price) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT BuyOrder.id, BuyOrder.floID, BuyOrder.quantity FROM BuyOrder" +
            " INNER JOIN Tags ON Tags.floID = BuyOrder.floID" +
            " WHERE Tags.tag = ? AND BuyOrder.maxPrice >=? ORDER BY BuyOrder.time_placed DESC", [tag, cur_price]).then(orders => {
            if (orders.length <= 1) // No (or) Only-one order, hence priority sort not required.
                resolve(orders);
            else
                getPointsFromAPI(tag, orders.map(o => o.floID)).then(points => {
                    let orders_sorted = orders.map(o => [o, points[o.floID]])
                        .sort((a, b) => a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0) //sort by points (ascending)
                        .map(x => x[0]);
                    resolve(orders_sorted);
                }).catch(error => reject(error))
        }).catch(error => reject(error))
    });
}

function getPointsFromAPI(tag, floIDs) {
    floIDs = Array.from(new Set(floIDs));
    return new Promise((resolve, reject) => {
        DB.query("SELECT api FROM TagList WHERE tag=?", [tag]).then(result => {
            let api = result[0].api;
            Promise.allSettled(floIDs.map(id => fetch_api(api, id))).then(result => {
                let points = {};
                for (let i in result)
                    if (result[i].status === "fulfilled")
                        points[floIDs[i]] = result[i].value;
                resolve(points);
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    });
}

function fetch_api(api, id) {
    return new Promise((resolve, reject) => {
        //TODO: fetch data from API
        let url = api.replace('<flo-id>', id);
        global.fetch(url).then(response => {
            if (response.ok)
                response.text()
                .then(result => resolve(result))
                .catch(error => reject(error))
            else
                reject(response);
        }).catch(error => reject(error))
    })
}

function getTopValidSellOrder(orders, cur_price, mode_null) {
    return new Promise((resolve, reject) => {
        if (!orders.length)
            return reject(false)
        verifySellOrder(orders.pop(), cur_price, mode_null) //pop: as the orders are sorted in ascending (highest point should be checked 1st)
            .then(result => resolve(result))
            .catch(error => {
                if (error !== false)
                    return reject(error);
                getTopValidSellOrder(orders, cur_price, mode_null)
                    .then(result => resolve(result))
                    .catch(error => reject(error));
            });
    });
}

function verifySellOrder(sellOrder, cur_price, mode_null) {
    return new Promise((resolve, reject) => {
        if (!mode_null)
            DB.query("SELECT quantity, base FROM Vault WHERE floID=? AND base IS NOT NULL ORDER BY base", [sellOrder.floID]).then(result => {
                let rem = sellOrder.quantity,
                    sell_base = 0,
                    base_quantity = 0;
                for (let i = 0; i < result.length && rem > 0; i++) {
                    if (rem < result[i].quantity) {
                        sell_base += (rem * result[i].base);
                        base_quantity += rem;
                        rem = 0;
                    } else {
                        sell_base += (result[i].quantity * result[i].base);
                        base_quantity += result[i].quantity;
                        rem -= result[i].quantity;
                    }
                }
                if (base_quantity)
                    sell_base = sell_base / base_quantity;
                if (sell_base > cur_price)
                    reject(false);
                else
                    resolve(sellOrder);
            }).catch(error => reject(error));
        else if (mode_null)
            DB.query("SELECT SUM(quantity) as total FROM Vault WHERE floID=?", [sellOrder.floID]).then(result => {
                if (result.total < sellOrder.quantity)
                    console.warn(`Sell Order ${sellOrder.id} was made without enough FLO. This should not happen`);
                if (result.total > 0)
                    resolve(sellOrder);
                else
                    reject(false);
            }).catch(error => reject(error))
    })
}

function getTopValidBuyOrder(orders, cur_price) {
    return new Promise((resolve, reject) => {
        if (!orders.length)
            return reject(false)
        verifyBuyOrder(orders.pop(), cur_price) //pop: as the orders are sorted in ascending (highest point should be checked 1st)
            .then(result => resolve(result))
            .catch(error => {
                if (error !== false)
                    return reject(error);
                getTopValidBuyOrder(orders, cur_price)
                    .then(result => resolve(result))
                    .catch(error => reject(error));
            });
    });
}

function verifyBuyOrder(buyOrder, cur_price) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT rupeeBalance AS bal FROM Cash WHERE floID=?", [buyOrder.floID]).then(result => {
            if (result[0].bal < cur_price * buyOrder.quantity) {
                //This should not happen unless a buy order is placed when user doesnt have enough rupee balance
                console.warn(`Buy order ${buyOrder.id} is active, but rupee# is insufficient`);
                reject(false);
            } else
                resolve(buyOrder);
        }).catch(error => reject(error));
    })
}

module.exports = {
    addTag,
    removeTag,
    getBestPairs,
    set DB(db) {
        DB = db;
    }
};