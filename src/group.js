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

function getBest() {
    return new Promise((resolve, reject) => {
        DB.query("SELECT tag FROM TagList ORDER BY priority DESC").then(result => {
            let tags = result.map(r => r.tag);
            recursiveGetBest(tags)
                .then(result => resolve(result))
                .catch(error => reject(error))
        })
    })
}

function recursiveGetBest(tags) {
    return new Promise((resolve, reject) => {
        let tag = tags.shift();
        getBestInTag(tag)
            .then(result => resolve(result))
            .catch(error => {
                if (error !== false)
                    return reject(error);
                else
                    recursiveGetBest(tags)
                    .then(result => resolve(result))
                    .catch(error => reject(error))
            })
    })
}

function getBestInTag(tag, cur_price) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT SellOrder.id, SellOrder.floID, SellOrder.quantity FROM SellOrder" +
            " INNER JOIN Tags ON Tags.floID = SellOrder.floID" +
            " WHERE Tags.tag = ? AND minPrice <=? ORDER BY time_placed", [tag, cur_price]).then(orders => {
            if (orders.length === 0)
                reject(false);
            else if (orders.length === 1)
                checkMinimumGain(orders[0])
                .then(result => resolve(result))
                .catch(error => reject(error))
            else
                getPointsFromAPI(orders.map(o => o.floID)).then(points => {
                    let orders_sorted = orders.map(o => [o, points[o.floID]])
                        .sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) //sort by points (ascending)
                        .map(x => x[0]);
                    getTopValidOrder(orders_sorted)
                        .then(result => resolve(result))
                        .catch(error => reject(error))
                }).catch(error => reject(error))
        })
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

function getTopValidOrder(orders) {
    return new Promise((resolve, reject) => {
        if (!orders.length)
            return reject(false)
        checkMinimumGain(orders.pop()) //pop: as the orders are sorted in ascending (highest point should be checked 1st)
            .then(result => resolve(result))
            .catch(error => {
                if (error !== false)
                    return reject(error);
                else
                    getTopValidOrder(orders)
                    .then(result => resolve(result))
                    .catch(error => reject(error));
            });
    });
}

function checkMinimumGain(sellOrder) {
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
    set DB(db) {
        DB = db;
    }
};