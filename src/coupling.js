'use strict';

const group = require("./group");
const price = require("./price");

var DB; //container for database

function initiate() {
    price.getRates().then(cur_rate => {
        group.getBestPairs(cur_rate)
            .then(bestPairQueue => processCoupling(bestPairQueue))
            .catch(error => console.error("initiateCoupling", error))
    }).catch(error => console.error(error));
}

function processCoupling(bestPairQueue) {
    bestPairQueue.get().then(pair_result => {
        let buyer_best = pair_result.buyOrder,
            seller_best = pair_result.sellOrder;
        console.debug("Sell:", seller_best);
        console.debug("Buy:", buyer_best);
        spendFLO(buyer_best, seller_best, pair_result.null_base).then(spend_result => {
            let tx_quantity = spend_result.quantity,
                txQueries = spend_result.txQueries,
                clear_sell = spend_result.incomplete && !spend_result.flag_baseNull; //clear_sell can be true only if an order is placed without enough FLO
            processOrders(seller_best, buyer_best, txQueries, tx_quantity, clear_sell);
            updateBalance(seller_best, buyer_best, txQueries, bestPairQueue.cur_rate, tx_quantity);
            //begin audit
            beginAudit(seller_best.floID, buyer_best.floID, bestPairQueue.cur_rate, tx_quantity).then(audit => {
                //process txn query in SQL
                DB.transaction(txQueries).then(_ => {
                    bestPairQueue.next(tx_quantity, spend_result.incomplete, spend_result.flag_baseNull);
                    console.log(`Transaction was successful! BuyOrder:${buyer_best.id}| SellOrder:${seller_best.id}`);
                    audit.end();
                    price.updateLastTime();
                    //Since a tx was successful, match again
                    processCoupling(bestPairQueue);
                }).catch(error => console.error(error));
            }).catch(error => console.error(error));
        }).catch(error => console.error(error));
    }).catch(error => {
        let noBuy, noSell;
        if (error.buy === undefined)
            noBuy = false;
        else if (error.buy !== false) {
            console.error(error.buy);
            noBuy = null;
        } else {
            console.log("No valid buyOrders.");
            noBuy = true;
        }
        if (error.sell === undefined)
            noSell = false;
        else if (error.sell !== false) {
            console.error(error.sell);
            noSell = null;
        } else {
            console.log("No valid sellOrders.");
            noSell = true;
        }
        price.noOrder(noBuy, noSell);
    });
}

function spendFLO(buyOrder, sellOrder, null_base) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT id, quantity, base FROM Vault WHERE floID=? ORDER BY base", [sellOrder.floID]).then(result => {
            let rem = Math.min(buyOrder.quantity, sellOrder.quantity),
                txQueries = [],
                flag_baseNull = false;
            for (let i = 0; i < result.length && rem > 0; i++)
                if (result[i].base || null_base) {
                    if (rem < result[i].quantity) {
                        txQueries.push(["UPDATE Vault SET quantity=quantity-? WHERE id=?", [rem, result[i].id]]);
                        rem = 0;
                    } else {
                        txQueries.push(["DELETE FROM Vault WHERE id=?", [result[i].id]]);
                        rem -= result[i].quantity;
                    }
                } else
                    flag_baseNull = true;
            resolve({
                quantity: Math.min(buyOrder.quantity, sellOrder.quantity) - rem,
                txQueries,
                incomplete: rem > 0,
                flag_baseNull
            });
        }).catch(error => reject(error));
    })
}

function processOrders(seller_best, buyer_best, txQueries, quantity, clear_sell) {
    if (quantity > buyer_best.quantity || quantity > seller_best.quantity)
        throw Error("Tx quantity cannot be more than order quantity");
    //Process Buy Order
    if (quantity == buyer_best.quantity)
        txQueries.push(["DELETE FROM BuyOrder WHERE id=?", [buyer_best.id]]);
    else
        txQueries.push(["UPDATE BuyOrder SET quantity=quantity-? WHERE id=?", [quantity, buyer_best.id]]);
    //Process Sell Order
    if (quantity == seller_best.quantity || clear_sell)
        txQueries.push(["DELETE FROM SellOrder WHERE id=?", [seller_best.id]]);
    else
        txQueries.push(["UPDATE SellOrder SET quantity=quantity-? WHERE id=?", [quantity, seller_best.id]]);
}

function updateBalance(seller_best, buyer_best, txQueries, cur_price, quantity) {
    //Update rupee balance for seller and buyer
    let totalAmount = cur_price * quantity;
    txQueries.push(["UPDATE Cash SET rupeeBalance=rupeeBalance+? WHERE floID=?", [totalAmount, seller_best.floID]]);
    txQueries.push(["UPDATE Cash SET rupeeBalance=rupeeBalance-? WHERE floID=?", [totalAmount, buyer_best.floID]]);
    //Add coins to Buyer
    txQueries.push(["INSERT INTO Vault(floID, base, quantity) VALUES (?, ?, ?)", [buyer_best.floID, cur_price, quantity]])
    //Record transaction
    txQueries.push(["INSERT INTO Transactions (seller, buyer, quantity, unitValue) VALUES (?, ?, ?, ?)", [seller_best.floID, buyer_best.floID, quantity, cur_price]]);
}

function beginAudit(sellerID, buyerID, unit_price, quantity) {
    return new Promise((resolve, reject) => {
        auditBalance(sellerID, buyerID).then(old_bal => resolve({
            end: () => endAudit(sellerID, buyerID, old_bal, unit_price, quantity)
        })).catch(error => reject(error))
    })
}

function endAudit(sellerID, buyerID, old_bal, unit_price, quantity) {
    auditBalance(sellerID, buyerID).then(new_bal => {
        DB.query("INSERT INTO auditTransaction (sellerID, buyerID, quantity, unit_price, total_cost, " +
            " Rupee_seller_old, Rupee_seller_new, Rupee_buyer_old, Rupee_buyer_new," +
            " FLO_seller_old, FLO_seller_new, FLO_buyer_old, FLO_buyer_new) " +
            " Value (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [sellerID, buyerID, quantity, unit_price, quantity * unit_price,
                old_bal[sellerID].Rupee, new_bal[sellerID].Rupee, old_bal[buyerID].Rupee, new_bal[buyerID].Rupee,
                old_bal[sellerID].FLO, new_bal[sellerID].FLO, old_bal[buyerID].FLO, new_bal[buyerID].FLO,
            ]).then(_ => null).catch(error => console.error(error))
    }).catch(error => console.error(error));
}

function auditBalance(sellerID, buyerID) {
    return new Promise((resolve, reject) => {
        let balance = {
            [sellerID]: {},
            [buyerID]: {}
        };
        DB.query("SELECT floID, rupeeBalance FROM Cash WHERE floID IN (?, ?)", [sellerID, buyerID]).then(result => {
            for (let i in result)
                balance[result[i].floID].Rupee = result[i].rupeeBalance;
            DB.query("SELECT floID, SUM(quantity) as floBal FROM Vault WHERE floID IN (?, ?) GROUP BY floID", [sellerID, buyerID]).then(result => {
                for (let i in result)
                    balance[result[i].floID].FLO = result[i].floBal;
                resolve(balance);
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

module.exports = {
    initiate,
    group,
    price,
    set DB(db) {
        DB = db;
        group.DB = db;
        price.DB = db;
    }
}