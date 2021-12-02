const group = require("./group");
const price = require("./price");
const MINIMUM_BUY_REQUIREMENT = 0.1;

var DB; //container for database

const tokenAPI = {
    fetch_api: function(apicall) {
        return new Promise((resolve, reject) => {
            console.log(floGlobals.tokenURL + apicall);
            fetch(floGlobals.tokenURL + apicall).then(response => {
                if (response.ok)
                    response.json().then(data => resolve(data));
                else
                    reject(response)
            }).catch(error => reject(error))
        })
    },
    getBalance: function(floID, token = 'rupee') {
        return new Promise((resolve, reject) => {
            this.fetch_api(`api/v1.0/getFloAddressBalance?token=${token}&floAddress=${floID}`)
                .then(result => resolve(result.balance || 0))
                .catch(error => reject(error))
        })
    },
    getTx: function(txID) {
        return new Promise((resolve, reject) => {
            this.fetch_api(`api/v1.0/getTransactionDetails/${txID}`).then(res => {
                if (res.result === "error")
                    reject(res.description);
                else if (!res.parsedFloData)
                    reject("Data piece (parsedFloData) missing");
                else if (!res.transactionDetails)
                    reject("Data piece (transactionDetails) missing");
                else
                    resolve(res);
            }).catch(error => reject(error))
        })
    },
    sendToken: function(privKey, amount, message = "", receiverID = floGlobals.adminID, token = 'rupee') {
        return new Promise((resolve, reject) => {
            let senderID = floCrypto.getFloID(privKey);
            if (typeof amount !== "number" || amount <= 0)
                return reject("Invalid amount");
            this.getBalance(senderID, token).then(bal => {
                if (amount > bal)
                    return reject("Insufficiant token balance");
                floBlockchainAPI.writeData(senderID, `send ${amount} ${token}# ${message}`, privKey, receiverID)
                    .then(txid => resolve(txid))
                    .catch(error => reject(error))
            }).catch(error => reject(error))
        });
    }
}

function returnRates() {
    return price.currentRate;
}

function addSellOrder(floID, quantity, min_price) {
    return new Promise((resolve, reject) => {
        if (!floID || !floCrypto.validateAddr(floID))
            return reject(INVALID("Invalid FLO ID"));
        else if (typeof quantity !== "number" || quantity <= 0)
            return reject(INVALID(`Invalid quantity (${quantity})`));
        else if (typeof min_price !== "number" || min_price <= 0)
            return reject(INVALID(`Invalid min_price (${min_price})`));
        checkSellRequirement().then(_ => {
            DB.query("SELECT SUM(quantity) AS total FROM Vault WHERE floID=?", [floID]).then(result => {
                let total = result.pop()["total"] || 0;
                if (total < quantity)
                    return reject(INVALID("Insufficient FLO"));
                DB.query("SELECT SUM(quantity) AS locked FROM SellOrder WHERE floID=?", [floID]).then(result => {
                    let locked = result.pop()["locked"] || 0;
                    let available = total - locked;
                    if (available < quantity)
                        return reject(INVALID("Insufficient FLO (Some FLO are locked in another sell order)"));
                    DB.query("INSERT INTO SellOrder(floID, quantity, minPrice) VALUES (?, ?, ?)", [floID, quantity, min_price])
                        .then(result => resolve("Added SellOrder to DB"))
                        .catch(error => reject(error));
                }).catch(error => reject(error));
            }).catch(error => reject(error));
        }).catch(error => reject(error));
    });
}

function checkSellRequirement(floID) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT * FROM Tags WHERE floID=? AND tag=?", [floID, "MINER"]).then(result => {
            if (result.length)
                return resolve(true);
            DB.query("SELECT SUM(quantity) AS brought FROM Transactions WHERE floID=?", [floID]).then(result => {
                if (result[0].brought >= MINIMUM_BUY_REQUIREMENT)
                    resolve(true);
                else
                    reject(INVALID(`Sellers required to buy atleast ${MINIMUM_BUY_REQUIREMENT} FLO before placing a sell order unless they are a Miner`));
            }).catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

function addBuyOrder(floID, quantity, max_price) {
    return new Promise((resolve, reject) => {
        if (!floID || !floCrypto.validateAddr(floID))
            return reject(INVALID("Invalid FLO ID"));
        else if (typeof quantity !== "number" || quantity <= 0)
            return reject(INVALID(`Invalid quantity (${quantity})`));
        else if (typeof max_price !== "number" || max_price <= 0)
            return reject(INVALID(`Invalid max_price (${max_price})`));
        DB.query("SELECT rupeeBalance FROM Cash WHERE floID=?", [floID]).then(result => {
            if (result.length < 1)
                return reject(INVALID("FLO ID not registered"));
            let total = result.pop()["rupeeBalance"];
            if (total < quantity * max_price)
                return reject(INVALID("Insufficient Rupee balance"));
            DB.query("SELECT SUM(maxPrice * quantity) AS locked FROM BuyOrder WHERE floID=?", [floID]).then(result => {
                let locked = result.pop()["locked"] || 0;
                let available = total - locked;
                if (available < quantity * max_price)
                    return reject(INVALID("Insufficient Rupee balance (Some rupee tokens are locked in another buy order)"));
                DB.query("INSERT INTO BuyOrder(floID, quantity, maxPrice) VALUES (?, ?, ?)", [floID, quantity, max_price])
                    .then(result => resolve("Added BuyOrder to DB"))
                    .catch(error => reject(error));
            }).catch(error => reject(error));
        }).catch(error => reject(error));
    });
}

function cancelOrder(type, id, floID) {
    return new Promise((resolve, reject) => {
        if (!floID || !floCrypto.validateAddr(floID))
            return reject(INVALID("Invalid FLO ID"));
        let tableName;
        if (type === "buy")
            tableName = "BuyOrder";
        else if (type === "sell")
            tableName = "SellOrder";
        else
            return reject(INVALID("Invalid Order type! Order type must be buy (or) sell"));
        DB.query(`SELECT floID FROM ${tableName} WHERE id=?`, [id]).then(result => {
            if (result.length < 1)
                return reject(INVALID("Order not found!"));
            else if (result[0].floID !== floID)
                return reject(INVALID("Order doesnt belong to the current user"));
            //Delete the order 
            DB.query(`DELETE FROM ${tableName} WHERE id=?`, [id])
                .then(result => resolve(tableName + "#" + id + " cancelled successfully"))
                .catch(error => reject(error));
        }).catch(error => reject(error));
    });
}

function initiateCoupling() {
    price.getRates().then(cur_rate => {
        group.getBestPairs(cur_rate)
            .then(bestPairQueue => processCoupling(bestPairQueue))
            .catch(error => console.error("initiateCoupling", error))
    }).catch(error => reject(error));
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
            //process txn query in SQL
            DB.transaction(txQueries).then(_ => {
                bestPairQueue.next(quantity, spend_result.incomplete, spend_result.flag_baseNull);
                console.log(`Transaction was successful! BuyOrder:${buyer_best.id}| SellOrder:${seller_best.id}`);
                price.updateLastTime();
                //Since a tx was successful, match again
                processCoupling(bestPairQueue);
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
        if (error.sell !== false) {
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
                txQueries = []
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

function getAccountDetails(floID) {
    return new Promise((resolve, reject) => {
        let select = [];
        select.push(["rupeeBalance", "Cash"]);
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

function depositFLO(floID, txid) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT status FROM inputFLO WHERE txid=? AND floID=?", [txid, floID]).then(result => {
            if (result.length) {
                switch (result[0].status) {
                    case "PENDING":
                        return reject(INVALID("Transaction already in process"));
                    case "REJECTED":
                        return reject(INVALID("Transaction already rejected"));
                    case "SUCCESS":
                        return reject(INVALID("Transaction already used to add coins"));
                }
            } else
                DB.query("INSERT INTO inputFLO(txid, floID, status) VALUES (?, ?, ?)", [txid, floID, "PENDING"])
                .then(result => resolve("Deposit request in process"))
                .catch(error => reject(error));
        }).catch(error => reject(error))
    });
}

function confirmDepositFLO() {
    DB.query("SELECT id, floID, txid FROM inputFLO WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => {
            confirmDepositFLO.checkTx(req.floID, req.txid).then(amount => {
                let txQueries = [];
                txQueries.push(["INSERT INTO Vault(floID, quantity) VALUES (?, ?)", [req.floID, amount]]);
                txQueries.push(["UPDATE inputFLO SET status=?, amount=? WHERE id=?", ["SUCCESS", amount, req.id]]);
                DB.transaction(txQueries)
                    .then(result => console.debug("FLO deposited for ", req.floID))
                    .catch(error => console.error(error))
            }).catch(error => {
                console.error(error);
                if (error[0])
                    DB.query("UPDATE inputFLO SET status=? WHERE id=?", ["REJECTED", req.id])
                    .then(_ => null).catch(error => console.error(error));
            });
        })
    }).catch(error => console.error(error))
}

confirmDepositFLO.checkTx = function(sender, txid) {
    return new Promise((resolve, reject) => {
        const receiver = global.myFloID; //receiver should be market's floID (ie, adminID)
        floBlockchainAPI.getTx(txid).then(tx => {
            let vin_sender = tx.vin.filter(v => v.addr === sender)
            if (!vin_sender.length)
                return reject([true, "Transaction not sent by the sender"]);
            if (vin_sender.length !== tx.vin.length)
                return reject([true, "Transaction input containes other floIDs"]);
            if (!tx.blockheight)
                return reject([false, "Transaction not included in any block yet"]);
            if (!tx.confirmations)
                return reject([false, "Transaction not confirmed yet"]);
            let amount = tx.vout.reduce((a, v) => v.scriptPubKey.addresses[0] === receiver ? a + v.value : a, 0);
            if (amount == 0)
                return reject([true, "Transaction receiver is not market ID"]);
            else
                resolve(amount);
        }).catch(error => reject([false, error]))
    })
}

function withdrawFLO(floID, amount) {
    return new Promise((resolve, reject) => {
        if (!floID || !floCrypto.validateAddr(floID))
            return reject(INVALID("Invalid FLO ID"));
        else if (typeof amount !== "number" || amount <= 0)
            return reject(INVALID(`Invalid amount (${amount})`));
        DB.query("SELECT SUM(quantity) AS total FROM Vault WHERE floID=?", [floID]).then(result => {
            let total = result.pop()["total"] || 0;
            if (total < amount)
                return reject(INVALID("Insufficient FLO"));
            DB.query("SELECT SUM(quantity) AS locked FROM SellOrder WHERE floID=?", [floID]).then(result => {
                let locked = result.pop()["locked"] || 0;
                let available = total - locked;
                if (available < amount)
                    return reject(INVALID("Insufficient FLO (Some FLO are locked in sell orders)"));
                DB.query("SELECT id, quantity, base FROM Vault WHERE floID=? ORDER BY locktime", [floID]).then(coins => {
                    let rem = amount,
                        txQueries = [];
                    for (let i = 0; i < coins.length && rem > 0; i++) {
                        if (rem < coins[i].quantity) {
                            txQueries.push(["UPDATE Vault SET quantity=quantity-? WHERE id=?", [rem, coins[i].id]]);
                            rem = 0;
                        } else {
                            txQueries.push(["DELETE FROM Vault WHERE id=?", [coins[i].id]]);
                            rem -= coins[i].quantity;
                        }
                    }
                    if (rem > 0) //should not happen AS the total and net is checked already
                        return reject(INVALID("Insufficient FLO"));
                    DB.transaction(txQueries).then(result => {
                        //Send FLO to user via blockchain API
                        floBlockchainAPI.sendTx(global.myFloID, floID, amount, global.myPrivKey, 'Withdraw FLO Coins from Market').then(txid => {
                            if (!txid)
                                throw Error("Transaction not successful");
                            //Transaction was successful, Add in DB
                            DB.query("INSERT INTO outputFLO (floID, amount, txid, status) VALUES (?, ?, ?, ?)", [floID, amount, txid, "WAITING_CONFIRMATION"])
                                .then(_ => null).catch(error => console.error(error))
                                .finally(_ => resolve("Withdrawal was successful"));
                        }).catch(error => {
                            console.debug(error);
                            DB.query("INSERT INTO outputFLO (floID, amount, status) VALUES (?, ?, ?)", [floID, amount, "PENDING"])
                                .then(_ => null).catch(error => console.error(error))
                                .finally(_ => resolve("Withdrawal request is in process"));
                        });
                    }).catch(error => reject(error));
                }).catch(error => reject(error));
            }).catch(error => reject(error));
        }).catch(error => reject(error));
    });
}

function retryWithdrawalFLO() {
    DB.query("SELECT id, floID, amount FROM outputFLO WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => {
            floBlockchainAPI.sendTx(global.myFloID, req.floID, req.amount, global.myPrivKey, 'Withdraw FLO Coins from Market').then(txid => {
                if (!txid)
                    throw Error("Transaction not successful");
                //Transaction was successful, Add in DB
                DB.query("UPDATE outputFLO SET status=? WHERE id=?", ["WAITING_CONFIRMATION", req.id])
                    .then(_ => null).catch(error => console.error(error));
            }).catch(error => console.error(error));
        })
    }).catch(error => reject(error));
}

function confirmWithdrawalFLO() {
    DB.query("SELECT id, floID, txid FROM outputFLO WHERE status=?", ["WAITING_CONFIRMATION"]).then(results => {
        results.forEach(req => {
            floBlockchainAPI.getTx(req.txid).then(tx => {
                if (!tx.blockheight || !tx.confirmations) //Still not confirmed
                    return;
                DB.query("UPDATE outputFLO SET status=? WHERE id=?", ["SUCCESS", req.id])
                    .then(result => console.debug("FLO withdrawed for ", req.floID))
                    .catch(error => console.error(error))
            }).catch(error => console.error(error));
        })
    }).catch(error => console.error(error));
}

function depositRupee(floID, txid) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT status FROM inputRupee WHERE txid=? AND floID=?", [txid, floID]).then(result => {
            if (result.length) {
                switch (result[0].status) {
                    case "PENDING":
                        return reject(INVALID("Transaction already in process"));
                    case "REJECTED":
                        return reject(INVALID("Transaction already rejected"));
                    case "SUCCESS":
                        return reject(INVALID("Transaction already used to add tokens"));
                }
            } else
                DB.query("INSERT INTO inputRupee(txid, floID, status) VALUES (?, ?, ?)", [txid, floID, "PENDING"])
                .then(result => resolve("Deposit request in process"))
                .catch(error => reject(error));
        }).catch(error => reject(error))
    });
}

function confirmDepositRupee() {
    DB.query("SELECT id, floID, txid FROM inputRupee WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => {
            confirmDepositRupee.checkTx(req.floID, req.txid).then(amounts => {
                DB.query("SELECT id FROM inputFLO where floID=? AND txid=?", [req.floID, req.txid]).then(result => {
                    let txQueries = [],
                        amount_rupee = amounts[0];
                    //Add the FLO balance if necessary
                    if (!result.length) {
                        let amount_flo = amounts[1];
                        txQueries.push(["INSERT INTO Vault(floID, quantity) VALUES (?, ?)", [req.floID, amount_flo]]);
                        txQueries.push(["INSERT INTO inputFLO(txid, floID, amount, status) VALUES (?, ?, ?, ?)", [req.txid, req.floID, amount_flo, "SUCCESS"]]);
                    }
                    txQueries.push(["UPDATE inputRupee SET status=? WHERE id=?", ["SUCCESS", req.id]]);
                    txQueries.push(["UPDATE Cash SET rupeeBalance=rupeeBalance+? WHERE floID=?", [amount_rupee, req.floID]]);
                    DB.transaction(txQueries)
                        .then(result => console.debug("Rupee deposited for ", req.floID))
                        .catch(error => console.error(error));
                }).catch(error => console.error(error));
            }).catch(error => {
                console.error(error);
                if (error[0])
                    DB.query("UPDATE inputRupee SET status=? WHERE id=?", ["REJECTED", req.id])
                    .then(_ => null).catch(error => console.error(error));
            });
        })
    }).catch(error => console.error(error))
}

confirmDepositRupee.checkTx = function(sender, txid) {
    return new Promise((resolve, reject) => {
        const receiver = global.myFloID; //receiver should be market's floID (ie, adminID)
        tokenAPI.getTx(txid).then(tx => {
            if (tx.parsedFloData.type !== "transfer")
                return reject([true, "Transaction type not 'transfer'"]);
            else if (tx.parsedFloData.transferType !== "token")
                return reject([true, "Transaction transfer is not 'token'"]);
            else if (tx.parsedFloData.tokenIdentification !== "rupee")
                return reject([true, "Transaction token is not 'rupee'"]);
            var amount_rupee = tx.parsedFloData.tokenAmount;
            let vin_sender = tx.transactionDetails.vin.filter(v => v.addr === sender)
            if (!vin_sender.length)
                return reject([true, "Transaction not sent by the sender"]);
            let amount_flo = tx.transactionDetails.vout.reduce((a, v) => v.scriptPubKey.addresses[0] === receiver ? a + v.value : a, 0);
            if (amount_flo == 0)
                return reject([true, "Transaction receiver is not market ID"]);
            else
                resolve([amount_rupee, amount_flo]);
        }).catch(error => reject([false, error]))
    })
}

function withdrawRupee(floID, amount) {
    return new Promise((resolve, reject) => {
        if (!floID || !floCrypto.validateAddr(floID))
            return reject(INVALID("Invalid FLO ID"));
        else if (typeof amount !== "number" || amount <= 0)
            return reject(INVALID(`Invalid amount (${amount})`));
        DB.query("SELECT SUM(quantity) AS total FROM Vault WHERE floID=?", [floID]).then(result => {
            let required_flo = floGlobals.sendAmt + floGlobals.fee,
                total = result.pop()["total"] || 0;
            if (total < required_flo)
                return reject(INVALID(`Insufficient FLO! Required ${required_flo} FLO to withdraw tokens`));
            DB.query("SELECT SUM(quantity) AS locked FROM SellOrder WHERE floID=?", [floID]).then(result => {
                let locked = result.pop()["locked"] || 0;
                let available = total - locked;
                if (available < required_flo)
                    return reject(INVALID(`Insufficient FLO (Some FLO are locked in sell orders)! Required ${required_flo} FLO to withdraw tokens`));
                DB.query("SELECT rupeeBalance FROM Cash WHERE floID=?", [floID]).then(result => {
                    if (result.length < 1)
                        return reject(INVALID(`FLO_ID: ${floID} not registered`));
                    if (result[0].rupeeBalance < amount)
                        return reject(INVALID('Insufficient Rupee balance'));
                    DB.query("SELECT id, quantity, base FROM Vault WHERE floID=? ORDER BY locktime", [floID]).then(coins => {
                        let rem = required_flo,
                            txQueries = [];
                        for (let i = 0; i < coins.length && rem > 0; i++) {
                            if (rem < coins[i].quantity) {
                                txQueries.push(["UPDATE Vault SET quantity=quantity-? WHERE id=?", [rem, coins[i].id]]);
                                rem = 0;
                            } else {
                                txQueries.push(["DELETE FROM Vault WHERE id=?", [coins[i].id]]);
                                rem -= result[i].quantity;
                            }
                        }
                        if (rem > 0) //should not happen AS the total and net is checked already
                            return reject(INVALID("Insufficient FLO"));
                        txQueries.push(["UPDATE Cash SET rupeeBalance=rupeeBalance-? WHERE floID=?", [amount, floID]]);

                        DB.transaction(txQueries).then(result => {
                            //Send FLO to user via blockchain API
                            tokenAPI.sendToken(global.myPrivKey, amount, '(withdrawal from market)', floID).then(txid => {
                                if (!txid)
                                    throw Error("Transaction not successful");
                                //Transaction was successful, Add in DB
                                DB.query("INSERT INTO outputRupee (floID, amount, txid, status) VALUES (?, ?, ?, ?)", [floID, amount, txid, "WAITING_CONFIRMATION"])
                                    .then(_ => null).catch(error => console.error(error))
                                    .finally(_ => resolve("Withdrawal was successful"));
                            }).catch(error => {
                                console.debug(error);
                                DB.query("INSERT INTO outputRupee (floID, amount, status) VALUES (?, ?, ?)", [floID, amount, "PENDING"])
                                    .then(_ => null).catch(error => console.error(error))
                                    .finally(_ => resolve("Withdrawal request is in process"));
                            });
                        }).catch(error => reject(error));
                    }).catch(error => reject(error));
                }).catch(error => reject(error));
            }).catch(error => reject(error));
        }).catch(error => reject(error));
    });
}

function retryWithdrawalRupee() {
    DB.query("SELECT id, floID, amount FROM outputRupee WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => {
            tokenAPI.sendToken(global.myPrivKey, req.amount, '(withdrawal from market)', req.floID).then(txid => {
                if (!txid)
                    throw Error("Transaction not successful");
                //Transaction was successful, Add in DB
                DB.query("UPDATE outputRupee SET status=?, txid=? WHERE id=?", ["WAITING_CONFIRMATION", txid, req.id])
                    .then(_ => null).catch(error => console.error(error));
            }).catch(error => console.error(error));
        });
    }).catch(error => reject(error));
}

function confirmWithdrawalRupee() {
    DB.query("SELECT id, floID, amount, txid FROM outputRupee WHERE status=?", ["WAITING_CONFIRMATION"]).then(results => {
        results.forEach(req => {
            tokenAPI.getTx(req.txid).then(tx => {
                DB.query("UPDATE outputRupee SET status=? WHERE id=?", ["SUCCESS", req.id])
                    .then(result => console.debug("Rupee withdrawed for ", req.floID))
                    .catch(error => console.error(error));
            }).catch(error => console.error(error));
        })
    }).catch(error => console.error(error));
}

function periodicProcess() {
    transactionReCheck();
    initiateCoupling();
}

function transactionReCheck() {
    confirmDepositFLO();
    confirmDepositRupee();
    retryWithdrawalFLO();
    retryWithdrawalRupee();
    confirmWithdrawalFLO();
    confirmWithdrawalRupee();
}

module.exports = {
    returnRates,
    addBuyOrder,
    addSellOrder,
    cancelOrder,
    getAccountDetails,
    depositFLO,
    withdrawFLO,
    depositRupee,
    withdrawRupee,
    periodicProcess,
    group,
    set DB(db) {
        DB = db;
        group.DB = db;
        price.DB = db;
    }
};