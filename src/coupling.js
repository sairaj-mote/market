'use strict';

const group = require("./group");
const price = require("./price");

var DB; //container for database

function startCouplingForAsset(asset) {
    price.getRates(asset).then(cur_rate => {
        group.getBestPairs(asset, cur_rate)
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
        spendAsset(bestPairQueue.asset, buyer_best, seller_best, pair_result.null_base).then(spend_result => {
            let tx_quantity = spend_result.quantity,
                txQueries = spend_result.txQueries,
                clear_sell = spend_result.incomplete && !spend_result.flag_baseNull; //clear_sell can be true only if an order is placed without enough ASSET
            processOrders(seller_best, buyer_best, txQueries, tx_quantity, clear_sell);
            updateBalance(seller_best, buyer_best, txQueries, bestPairQueue.asset, bestPairQueue.cur_rate, tx_quantity);
            //begin audit
            beginAudit(seller_best.floID, buyer_best.floID, bestPairQueue.asset, bestPairQueue.cur_rate, tx_quantity).then(audit => {
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
        price.noOrder(bestPairQueue.asset, noBuy, noSell);
    });
}

function spendAsset(asset, buyOrder, sellOrder, null_base) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT id, quantity, base FROM Vault WHERE floID=? AND asset=? ORDER BY base", [sellOrder.floID, asset]).then(result => {
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

function updateBalance(seller_best, buyer_best, txQueries, asset, cur_price, quantity) {
    //Update cash balance for seller and buyer
    let totalAmount = cur_price * quantity;
    txQueries.push(["UPDATE Cash SET balance=balance+? WHERE floID=?", [totalAmount, seller_best.floID]]);
    txQueries.push(["UPDATE Cash SET balance=balance-? WHERE floID=?", [totalAmount, buyer_best.floID]]);
    //Add coins to Buyer
    txQueries.push(["INSERT INTO Vault(floID, asset, base, quantity) VALUES (?, ?, ?, ?)", [buyer_best.floID, asset, cur_price, quantity]])
    //Record transaction
    txQueries.push(["INSERT INTO TransactionHistory (seller, buyer, asset, quantity, unitValue) VALUES (?, ?, ?, ?, ?)", [seller_best.floID, buyer_best.floID, asset, quantity, cur_price]]);
}

function beginAudit(sellerID, buyerID, asset, unit_price, quantity) {
    return new Promise((resolve, reject) => {
        auditBalance(sellerID, buyerID, asset).then(old_bal => resolve({
            end: () => endAudit(sellerID, buyerID, asset, old_bal, unit_price, quantity)
        })).catch(error => reject(error))
    })
}

function endAudit(sellerID, buyerID, asset, old_bal, unit_price, quantity) {
    auditBalance(sellerID, buyerID, asset).then(new_bal => {
        DB.query("INSERT INTO AuditTransaction (asset, quantity, unit_price, total_cost," +
            " sellerID, seller_old_cash, seller_old_asset, seller_new_cash, seller_new_asset," +
            " buyerID, buyer_old_cash, buyer_old_asset, buyer_new_cash, buyer_new_asset)" +
            " Value (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                asset, quantity, unit_price, quantity * unit_price,
                sellerID, old_bal[sellerID].cash, old_bal[sellerID].asset, new_bal[sellerID].cash, new_bal[sellerID].asset,
                buyerID, old_bal[buyerID].cash, old_bal[buyerID].asset, new_bal[buyerID].cash, new_bal[buyerID].asset,
            ]).then(_ => null).catch(error => console.error(error))
    }).catch(error => console.error(error));
}

function auditBalance(sellerID, buyerID, asset) {
    return new Promise((resolve, reject) => {
        let balance = {
            [sellerID]: {},
            [buyerID]: {}
        };
        DB.query("SELECT floID, balance FROM Cash WHERE floID IN (?, ?)", [sellerID, buyerID]).then(result => {
            for (let i in result)
                balance[result[i].floID].cash = result[i].balance;
            DB.query("SELECT floID, SUM(quantity) as asset_balance FROM Vault WHERE asset=? AND floID IN (?, ?) GROUP BY floID", [asset, sellerID, buyerID]).then(result => {
                for (let i in result)
                    balance[result[i].floID].asset = result[i].asset_balance;
                resolve(balance);
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

module.exports = {
    initiate: startCouplingForAsset,
    group: {
        addTag: group.addTag,
        removeTag: group.removeTag
    },
    price,
    set DB(db) {
        DB = db;
        group.DB = db;
        price.DB = db;
    }
}