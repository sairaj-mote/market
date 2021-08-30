var net_FLO_price; //container for FLO price (from API or by model)
var DB; //container for database

function addSellOrder(floID, quantity, min_price) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT SUM(quantity) as total FROM Vault WHERE floID=?", [floID]).then(result => {
            let total = result.pop()["total"];
            if (total < quantity)
                return reject(INVALID("Insufficient FLO"));
            DB.query("SELECT SUM(quantity) as locked FROM SellOrder WHERE floID=?", [floID]).then(result => {
                let locked = result.pop()["locked"] || 0;
                let available = total - locked;
                console.debug(total, locked, available);
                if (available < quantity)
                    return reject(INVALID("Insufficient FLO (Some FLO are locked in another sell order)"));
                DB.query("INSERT INTO SellOrder(floID, quantity, minPrice) VALUES (?, ?, ?)", [floID, quantity, min_price])
                    .then(result => resolve("Added SellOrder to DB"))
                    .catch(error => reject(error));
            }).catch(error => reject(error));
        }).catch(error => reject(error));
    });
}
/*
function addSellOrder(floID, quantity, min_price) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT id, base, (quantity - locked) as available FROM Vault WHERE floID=? ORDER BY base", [floID]).then(result => {
            console.debug(result);
            let rem = quantity,
                sell_base = 0,
                txQueries = [];
            for (let i = 0; i < result.length && rem > 0; i++) {
                var lock = (rem < result[i].available ? rem : result[i].available);
                rem -= lock;
                sell_base += (lock * result[i].base);
                txQueries.push(["UPDATE Vault SET locked=locked-? WHERE id=?", [lock, result[i].id]]);
            }
            if (rem > 0)
                return reject(INVALID("Insufficient FLO"));
            sell_base = sell_base / quantity;
            Promise.all(txQueries.map(a => DB.query(a[0], a[1]))).then(results => {
                DB.query("INSERT INTO SellOrder(floID, quantity, minPrice, sellBase) VALUES (?, ?, ?)", [floID, quantity, min_price, sell_base])
                    .then(result => resolve(result))
                    .catch(error => reject(error));
            }).catch(error => reject(error));
        }).catch(error => reject(error))
    })
}
*/

function addBuyOrder(floID, quantity, max_price) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT rupeeBalance FROM Users WHERE floID=?", [floID]).then(result => {
            let total = result.pop()["rupeeBalance"];
            if (total < quantity * max_price)
                return reject(INVALID("Insufficient Rupee balance"));
            DB.query("SELECT SUM(maxPrice * quantity) as locked FROM BuyOrder WHERE floID=?", [floID]).then(result => {
                let locked = result.pop()["locked"] || 0;
                let available = total - locked;
                console.debug(total, locked, available);
                if (available < quantity * max_price)
                    return reject(INVALID("Insufficient Rupee balance (Some rupee tokens are locked in another buy order)"));
                DB.query("INSERT INTO BuyOrder(floID, quantity, maxPrice) VALUES (?, ?, ?)", [floID, quantity, max_price])
                    .then(result => resolve("Added BuyOrder to DB"))
                    .catch(error => reject(error));
            }).catch(error => reject(error));
        }).catch(error => reject(error));
    });
}

function matchBuyAndSell() {
    let cur_price = net_FLO_price;
    //get the best buyer
    getBestBuyer(cur_price).then(buyer_best => {
        //get the best seller
        getBestSeller(buyer_best.quantity, cur_price).then(result => {
            let seller_best = result.sellOrder,
                txQueries = result.txQueries;
            //process the Txn
            var tx_quantity;
            if (seller_best.quantity > buyer_best.quantity)
                tx_quantity = processBuyOrder(seller_best, buyer_best, txQueries);
            else if (seller_best.quantity < buyer_best.quantity)
                tx_quantity = processSellOrder(seller_best, buyer_best, txQueries);
            else
                tx_quantity = processBuyAndSellOrder(seller_best, buyer_best, txQueries);
            updateBalance(seller_best, buyer_best, txQueries, cur_price, tx_quantity);
            //process txn query in SQL
            DB.TxQuery(txQueries).then(results => {
                console.log(`Transaction was successful! BuyOrder:${buyer_best.id}| SellOrder:${seller_best.id}`);
                //Since a tx was successful, match again
                matchBuyAndSell();
            }).catch(error => console.error(error));
        }).catch(error => console.error(error));
    }).catch(error => console.error(error));
}

function getBestBuyer(cur_price, n = 0) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT * FROM BuyOrder WHERE maxPrice >= ? ORDER BY time_placed LIMIT=?,1", [cur_price, n]).then(result => {
            let buyOrder = result.shift();
            if (!buyOrder)
                return reject("No valid buyers available");
            DB.query("SELECT rupeeBalance as bal FROM Users WHERE floID=?", [buyOrder.floID]).then(result => {
                if (result[0].bal < cur_price * buyOrder.quantity) {
                    //This should not happen unless a buy order is placed when user doesnt have enough rupee balance
                    console.warn(`Buy order ${buyOrder.id} is active, but rupee# is insufficient`);
                    getBestBuyer(cur_price, n + 1)
                        .then(result => resolve(result))
                        .catch(error => reject(error));
                } else
                    resolve(buyOrder);
            }).catch(error => reject(error));
        }).catch(error => reject(error));
    });
}

function getBestSeller(maxQuantity, cur_price, n = 0) {
    return new Promise((resolve, reject) => {
        //TODO: Add order conditions for priority.
        DB.query("SELECT * FROM SellOrder WHERE minPrice <=? ORDER BY time_placed LIMIT=?,1", [cur_price, n]).then(result => {
            let sellOrder = result.shift();
            if (!sellOrder)
                return reject("No valid sellers available");
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
                            base_quantity += rem
                        }
                        rem = 0;
                    } else {
                        txQueries.push(["DELETE FROM Vault WHERE id=?", [result[i].id]]);
                        if (result[i].base) {
                            sell_base += (result[i].quantity * result[i].base);
                            base_quantity += result[i].quantity
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
                    getBestSeller(maxQuantity, cur_price, n + 1)
                        .then(result => resolve(result))
                        .catch(error => reject(error));
                } else
                    resolve({
                        sellOrder,
                        txQueries
                    });
            }).catch(error => reject(error));
        }).catch(error => reject(error));
    });
}

function processBuyOrder(seller_best, buyer_best, txQueries) {
    let quantity = buyer_best.quantity;
    //Buy order is completed, sell order is partially done.
    txQueries.push(["DELETE FROM BuyOrder WHERE id=?", [buyer_best.id]]);
    txQueries.push(["UPDATE SellOrder SET quantity=quantity-? WHERE id=?", [quantity, seller_best.id]]);
    return quantity;
}

function processSellOrder(seller_best, buyer_best, txQueries) {
    let quantity = buyer_best.quantity;
    //Sell order is completed, buy order is partially done.
    txQueries.push(["DELETE FROM SellOrder WHERE id=?", [seller_best.id]]);
    txQueries.push(["UPDATE BuyOrder SET quantity=quantity-? WHERE id=?", [quantity, buyer_best.id]]);
    return quantity;
}

function processBuyAndSellOrder(seller_best, buyer_best, txQueries) {
    //Both sell order and buy order is completed
    txQueries.push(["DELETE FROM SellOrder WHERE id=?", [seller_best.id]]);
    txQueries.push(["DELETE FROM BuyOrder WHERE id=?", [buyer_best.id]]);
    return seller_best.quantity;
}

function updateBalance(seller_best, buyer_best, txQueries, cur_price, quantity) {
    //Update rupee balance for seller and buyer
    let totalAmount = cur_price * quantity;
    txQueries.push(["UPDATE Users SET rupeeBalance=rupeeBalance+? WHERE floID=?", [totalAmount, seller_best.floID]]);
    txQueries.push(["UPDATE Users SET rupeeBalance=rupeeBalance-? WHERE floID=?", [totalAmount, buyer_best.floID]]);
    //Add coins to Buyer
    txQueries.push(["INSERT INTO Vault(floID, base, quantity) VALUES (?, ?, ?)", [buyer_best.floID, cur_price, quantity]])
    //Record transaction
    txQueries.push(["INSERT INTO Transactions (seller, buyer, quantity, unitValue) VALUES (?, ?, ?)", [seller_best.floID, buyer_best.floID, quantity, cur_price]]);
    return;
}

function getAccountDetails(floID) {
    return new Promise((resolve, reject) => {
        let select = [];
        select.push(["rupeeBalance", "Users"]);
        select.push(["base, quantity", "Vault"]);
        select.push(["id, quantity, minPrice, time_placed", "SellOrder"]);
        select.push(["id, quantity, maxPrice, time_placed", "BuyOrder"]);
        let promises = select.map(a => DB.query("SELECT " + a[0] + " FROM " + a[1] + " WHERE floID=?", [floID]));
        Promise.allSettled(promises).then(results => {
            let response = {
                floID: floID,
                time: Date.now()
            };
            results.forEach((a, i) => {
                if (a.status === "rejected")
                    console.error(a.reason);
                else
                    switch (i) {
                        case 0:
                            response.rupee_total = a.value[0].rupeeBalance;
                            break;
                        case 1:
                            response.coins = a.value;
                            break;
                        case 2:
                            response.sellOrders = a.value;
                            break;
                        case 3:
                            response.buyOrders = a.value;
                            break;
                    }
            });
            DB.query("SELECT * FROM Transactions WHERE seller=? OR buyer=?", [floID, floID])
                .then(result => response.transactions = result)
                .catch(error => console.error(error))
                .finally(_ => resolve(response));
        });
    });
}

module.exports = {
    addBuyOrder,
    addSellOrder,
    getAccountDetails,
    set DB(db) {
        DB = db;
    }
};