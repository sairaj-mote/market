var DB; //container for database

function addTag(floID, tag) {
    return new Promise((resolve, reject) => {
        DB.query("INSERT INTO Tags (floID, tag) VALUE (?,?)", [floID, tag])
            .then(result => resolve(`Added ${floID} to ${tag}`))
            .catch(error => {
                if (error.code === "ER_DUP_ENTRY")
                    reject(`${floID} already in ${tag}`);
                else
                    reject(error);
            });
    });
}

function getBestPairs(currentRate) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT tag FROM TagList ORDER BY priority").then(result => {
            let tags = result.map(r => r.tag) //Sorted in Ascending (ie, stack; pop for highest)
            resolve(new bestPair(tags, currentRate));
        }).catch(error => reject(error))
    })
}

const bestPair = function(tags, currentRate) {

    const getSellOrder = () => {
        let cache = getSellOrder.cache;
        return new Promise((resolve, reject) => {
            if (cache.cur_order) { //If cache already has a pending order
                checkMinimumGain(cache.cur_order, currentRate).then(result => {
                    cache.cur_order = result.sellOrder;
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
                getTopValidOrder(cache.orders, currentRate).then(result => {
                    cache.cur_order = result.sellOrder;
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
                getOrdersInTag(cache.cur_tag, currentRate).then(orders => {
                    cache.orders = orders;
                    getSellOrder()
                        .then(result => resolve(result))
                        .catch(error => reject(error))
                }).catch(error => reject(error));
            } else if (!cache.end) { //Un-tagged floID's orders  (do only once)
                getUntaggedOrders(currentRate).then(orders => {
                    cache.orders = orders;
                    cache.end = true;
                    getSellOrder()
                        .then(result => resolve(result))
                        .catch(error => reject(error))
                }).catch(error => reject(error));
            }
        })
    };
    getSeller.cache = {
        tags: Array.from(tags)
    };

    const getBuyOrder = () => {};
    getBuyOrder.cache = {
        tags: Array.from(tags) //Maybe diff for buy and sell ?
    };
}

function getUntaggedOrders(cur_price) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT SellOrder.id, SellOrder.floID, SellOrder.quantity FROM SellOrder" +
                " LEFT JOIN Tags ON Tags.floID = SellOrder.floID" +
                " WHERE Tags.floID IS NULL AND SellOrder.minPrice <=? ORDER BY SellOrder.time_placed", [cur_price])
            .then(orders => resolve(orders))
            .catch(error => reject(error))
    })
}

function getOrdersInTag(tag, cur_price) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT SellOrder.id, SellOrder.floID, SellOrder.quantity FROM SellOrder" +
            " INNER JOIN Tags ON Tags.floID = SellOrder.floID" +
            " WHERE Tags.tag = ? AND SellOrder.minPrice <=? ORDER BY SellOrder.time_placed", [tag, cur_price]).then(orders => {
            if (orders.length <= 1) // No (or) Only-one order, hence priority sort not required.
                resolve(orders);
            else
                getPointsFromAPI(orders.map(o => o.floID)).then(points => {
                    let orders_sorted = orders.map(o => [o, points[o.floID]])
                        .sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) //sort by points (ascending)
                        .map(x => x[0]);
                    resolve(orders_sorted);
                }).catch(error => reject(error))
        }).catch(error => reject(error))
    });
}

function getPointsFromAPI(floIDs) {
    floIDs = Array.from(new Set(floIDs));
    return new Promise((resolve, reject) => {
        DB.query("SELECT api FROM TagList WHERE tag=?", [tag]).then(result => {
            let api = result[0].api;
            Promise.allSettled(floIDs.map(id => fetch_api(api, id))).then(result => {
                let points = {};
                for (let i in result)
                    if (result[i].status === "fulfilled")
                        points[floIDs[i]] = result[i];
                resolve(points);
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    });
}

function fetch_api(api, id) {
    return new Promise((resolve, reject) => {
        //TODO: fetch data from API
    })
}

function getTopValidOrder(orders, cur_price) {
    return new Promise((resolve, reject) => {
        if (!orders.length)
            return reject(false)
        checkMinimumGain(orders.pop(), cur_price) //pop: as the orders are sorted in ascending (highest point should be checked 1st)
            .then(result => resolve(result))
            .catch(error => {
                if (error !== false)
                    return reject(error);
                getTopValidOrder(orders, cur_price)
                    .then(result => resolve(result))
                    .catch(error => reject(error));
            });
    });
}

function checkMinimumGain(sellOrder, cur_price) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT id, quantity, base FROM Vault WHERE floID=? ORDER BY base", [sellOrder.floID]).then(result => {
            let rem = Math.min(sellOrder.quantity, maxQuantity),
                sell_base = 0,
                base_quantity = 0,
                txQueries = [];
            for (let i = 0; i < result.length && rem > 0; i++) {
                if (rem < result[i].quantity) {
                    txQueries.push(["UPDATE Vault SET quantity=quantity-? WHERE id=?", [rem, result[i].id]]);
                    if (result[i].base) {
                        sell_base += (rem * result[i].base);
                        base_quantity += rem;
                    }
                    rem = 0;
                } else {
                    txQueries.push(["DELETE FROM Vault WHERE id=?", [result[i].id]]);
                    if (result[i].base) {
                        sell_base += (result[i].quantity * result[i].base);
                        base_quantity += result[i].quantity;
                    }
                    rem -= result[i].quantity;
                }
            }
            if (base_quantity)
                sell_base = sell_base / base_quantity;
            if (rem > 0 || sell_base > cur_price) {
                //1st condition (rem>0) should not happen (sell order placement was success when insufficient FLO).
                if (rem > 0)
                    console.warn(`Sell order ${sellOrder.id} is active, but FLO is insufficient`);
                reject(false);
            } else
                resolve({
                    sellOrder,
                    txQueries
                });
        }).catch(error => reject(error));
    })

}

module.exports = {
    addTag,
    getBestPairs,
    set DB(db) {
        DB = db;
    }
};