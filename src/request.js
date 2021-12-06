'use strict';

const market = require("./market");
var DB, trustedIDs; //container for database

global.INVALID = function(message) {
    if (!(this instanceof INVALID))
        return new INVALID(message);
    this.message = message;
}
INVALID.e_code = 400;

global.INTERNAL = function INTERNAL(message) {
    if (!(this instanceof INTERNAL))
        return new INTERNAL(message);
    this.message = message;
}
INTERNAL.e_code = 500;

// creating 24 hours from milliseconds
const oneDay = 1000 * 60 * 60 * 24;
const maxSessionTimeout = 60 * oneDay;

function validateRequestFromFloID(request, sign, floID, proxy = true) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT " + (proxy ? "proxyKey AS pubKey FROM Sessions" : "pubKey FROM Users") + " WHERE floID=?", [floID]).then(result => {
            if (result.length < 1)
                return reject(INVALID(proxy ? "Session not active" : "User not registered"));
            let req_str = validateRequest(request, sign, result[0].pubKey);
            req_str instanceof INVALID ? reject(req_str) : resolve(req_str);
        }).catch(error => reject(error));
    });
}

function validateRequest(request, sign, pubKey) {
    if (typeof request !== "object")
        return INVALID("Request is not an object");
    let req_str = Object.keys(request).sort().map(r => r + ":" + request[r]).join("|");
    try {
        if (floCrypto.verifySign(req_str, sign, pubKey))
            return req_str;
        else
            return INVALID("Invalid request signature! Re-login if this error occurs frequently");
    } catch {
        return INVALID("Corrupted sign/key");
    }
}

function storeRequest(floID, req_str, sign) {
    console.debug(floID, req_str);
    DB.query("INSERT INTO Request_Log (floID, request, sign) VALUES (?,?,?)", [floID, req_str, sign])
        .then(_ => null).catch(error => console.error(error));
}

function SignUp(req, res) {
    let data = req.body,
        session = req.session;
    if (floCrypto.getFloID(data.pubKey) !== data.floID)
        return res.status(INVALID.e_code).send("Invalid Public Key");
    if (!session.random)
        return res.status(INVALID.e_code).send("Invalid Session");
    let req_str = validateRequest({
        type: "create_account",
        random: session.random,
        timestamp: data.timestamp
    }, data.sign, data.pubKey);
    if (req_str instanceof INVALID)
        return res.status(INVALID.e_code).send(req_str.message);
    let txQueries = [];
    txQueries.push(["INSERT INTO Users(floID, pubKey) VALUES (?, ?)", [data.floID, data.pubKey]]);
    txQueries.push(["INSERT INTO Cash (floID) Values (?)", [data.floID]]);
    DB.transaction(txQueries).then(_ => {
        storeRequest(data.floID, req_str, data.sign);
        res.send("Account Created");
    }).catch(error => {
        if (error.code === "ER_DUP_ENTRY")
            res.status(INVALID.e_code).send("Account already exist");
        else {
            console.error(error);
            res.status(INTERNAL.e_code).send("Account creation failed! Try Again Later!");
        }
    });
}

function Login(req, res) {
    let data = req.body,
        session = req.session;
    if (!session.random)
        return res.status(INVALID.e_code).send("Invalid Session");
    validateRequestFromFloID({
        type: "login",
        random: session.random,
        proxyKey: data.proxyKey,
        timestamp: data.timestamp
    }, data.sign, data.floID, false).then(req_str => {
        DB.query("INSERT INTO Sessions (floID, session_id, proxyKey) VALUES (?, ?, ?) " +
            "ON DUPLICATE KEY UPDATE session_id=?, session_time=DEFAULT, proxyKey=?",
            [data.floID, req.sessionID, data.proxyKey, req.sessionID, data.proxyKey]).then(_ => {
            if (data.saveSession)
                session.cookie.maxAge = maxSessionTimeout;
            session.user_id = data.floID;
            storeRequest(data.floID, req_str, data.sign);
            res.send("Login Successful");
        }).catch(error => {
            console.error(error);
            res.status(INTERNAL.e_code).send("Login failed! Try again later!");
        });
    }).catch(error => {
        if (error instanceof INVALID)
            res.status(INVALID.e_code).send(error.message);
        else {
            console.error(error);
            res.status(INTERNAL.e_code).send("Login failed! Try again later!");
        }
    })
}

function Logout(req, res) {
    let session = req.session;
    if (!session.user_id)
        return res.status(INVALID.e_code).send("No logged in user found in this session");
    DB.query("DELETE FROM Sessions WHERE floID=?", [session.user_id]).then(_ => {
        session.destroy();
        res.send('Logout successful');
    }).catch(error => {
        console.error(error);
        res.status(INTERNAL.e_code).send("Logout failed! Try again later! Contact support if this error occurs frequently");
    });
}

function PlaceSellOrder(req, res) {
    let data = req.body,
        session = req.session;
    if (!session.user_id)
        return res.status(INVALID.e_code).send("Login required");
    validateRequestFromFloID({
        type: "sell_order",
        quantity: data.quantity,
        min_price: data.min_price,
        timestamp: data.timestamp
    }, data.sign, session.user_id).then(req_str => {
        market.addSellOrder(session.user_id, data.quantity, data.min_price)
            .then(result => {
                storeRequest(session.user_id, req_str, data.sign);
                res.send('Sell Order placed successfully');
            }).catch(error => {
                if (error instanceof INVALID)
                    res.status(INVALID.e_code).send(error.message);
                else {
                    console.error(error);
                    res.status(INTERNAL.e_code).send("Order placement failed! Try again later!");
                }
            });
    }).catch(error => {
        if (error instanceof INVALID)
            res.status(INVALID.e_code).send(error.message);
        else {
            console.error(error);
            res.status(INTERNAL.e_code).send("Request processing failed! Try again later!");
        }
    });
}

function PlaceBuyOrder(req, res) {
    let data = req.body,
        session = req.session;
    if (!session.user_id)
        return res.status(INVALID.e_code).send("Login required");
    validateRequestFromFloID({
        type: "buy_order",
        quantity: data.quantity,
        max_price: data.max_price,
        timestamp: data.timestamp
    }, data.sign, session.user_id).then(req_str => {
        market.addBuyOrder(session.user_id, data.quantity, data.max_price)
            .then(result => {
                storeRequest(session.user_id, req_str, data.sign);
                res.send('Buy Order placed successfully');
            }).catch(error => {
                if (error instanceof INVALID)
                    res.status(INVALID.e_code).send(error.message);
                else {
                    console.error(error);
                    res.status(INTERNAL.e_code).send("Order placement failed! Try again later!");
                }
            });
    }).catch(error => {
        if (error instanceof INVALID)
            res.status(INVALID.e_code).send(error.message);
        else {
            console.error(error);
            res.status(INTERNAL.e_code).send("Request processing failed! Try again later!");
        }
    });
}

function CancelOrder(req, res) {
    let data = req.body,
        session = req.session;
    if (!session.user_id)
        return res.status(INVALID.e_code).send("Login required");
    validateRequestFromFloID({
        type: "cancel_order",
        order: data.orderType,
        id: data.orderID,
        timestamp: data.timestamp
    }, data.sign, session.user_id).then(req_str => {
        market.cancelOrder(data.orderType, data.orderID, session.user_id)
            .then(result => {
                storeRequest(session.user_id, req_str, data.sign);
                res.send(result);
            }).catch(error => {
                if (error instanceof INVALID)
                    res.status(INVALID.e_code).send(error.message);
                else {
                    console.error(error);
                    res.status(INTERNAL.e_code).send("Order cancellation failed! Try again later!");
                }
            });
    }).catch(error => {
        if (error instanceof INVALID)
            res.status(INVALID.e_code).send(error.message);
        else {
            console.error(error);
            res.status(INTERNAL.e_code).send("Request processing failed! Try again later!");
        }
    });
}

function ListSellOrders(req, res) {
    //TODO: Limit size (best)
    DB.query("SELECT * FROM SellOrder ORDER BY time_placed")
        .then(result => res.send(result))
        .catch(error => res.status(INTERNAL.e_code).send("Try again later!"));
}

function ListBuyOrders(req, res) {
    //TODO: Limit size (best)
    DB.query("SELECT * FROM BuyOrder ORDER BY time_placed")
        .then(result => res.send(result))
        .catch(error => res.status(INTERNAL.e_code).send("Try again later!"));
}

function ListTransactions(req, res) {
    //TODO: Limit size (recent)
    DB.query("SELECT * FROM Transactions ORDER BY tx_time DESC")
        .then(result => res.send(result))
        .catch(error => res.status(INTERNAL.e_code).send("Try again later!"));
}

function getRate(req, res) {
    let rate = market.returnRates();
    res.send(`${rate}`);
}

function Account(req, res) {
    const setLogin = function(message) {
        let randID = floCrypto.randString(16, true);
        req.session.random = randID;
        res.status(INVALID.e_code).send({
            message,
            sid: randID
        });
    }
    if (!req.session.user_id)
        setLogin("Login required");
    else {
        DB.query("SELECT session_id, session_time FROM Sessions WHERE floID=?", [req.session.user_id]).then(result => {
            if (result.length < 1) {
                res.status(INVALID.e_code).send("floID not registered");
                return;
            }
            let {
                session_id,
                session_time
            } = result.pop();
            if (!session_id || session_id != req.sessionID || session_time + maxSessionTimeout < Date.now())
                setLogin("Session Expired! Re-login required");
            else {
                let floID = req.session.user_id;
                market.getAccountDetails(floID).then(result => {
                    if (trustedIDs.includes(floID))
                        result.subAdmin = true;
                    res.send(result)
                });
            }
        }).catch(_ => res.status(INTERNAL.e_code).send("Try again later!"));
    }
}

function DepositFLO(req, res) {
    let data = req.body,
        session = req.session;
    if (!session.user_id)
        return res.status(INVALID.e_code).send("Login required");
    validateRequestFromFloID({
        type: "deposit_FLO",
        txid: data.txid,
        timestamp: data.timestamp
    }, data.sign, session.user_id).then(req_str => {
        market.depositFLO(session.user_id, data.txid).then(result => {
            storeRequest(session.user_id, req_str, data.sign);
            res.send(result);
        }).catch(error => {
            if (error instanceof INVALID)
                res.status(INVALID.e_code).send(error.message);
            else {
                console.error(error);
                res.status(INTERNAL.e_code).send("Request processing failed! Try again later!");
            }
        });
    }).catch(error => {
        if (error instanceof INVALID)
            res.status(INVALID.e_code).send(error.message);
        else {
            console.error(error);
            res.status(INTERNAL.e_code).send("Request processing failed! Try again later!");
        }
    });
}

function WithdrawFLO(req, res) {
    let data = req.body,
        session = req.session;
    if (!session.user_id)
        return res.status(INVALID.e_code).send("Login required");
    validateRequestFromFloID({
        type: "withdraw_FLO",
        amount: data.amount,
        timestamp: data.timestamp
    }, data.sign, session.user_id).then(req_str => {
        market.withdrawFLO(session.user_id, data.amount).then(result => {
            storeRequest(session.user_id, req_str, data.sign);
            res.send(result);
        }).catch(error => {
            if (error instanceof INVALID)
                res.status(INVALID.e_code).send(error.message);
            else {
                console.error(error);
                res.status(INTERNAL.e_code).send("Request processing failed! Try again later!");
            }
        });
    }).catch(error => {
        if (error instanceof INVALID)
            res.status(INVALID.e_code).send(error.message);
        else {
            console.error(error);
            res.status(INTERNAL.e_code).send("Request processing failed! Try again later!");
        }
    });
}

function DepositRupee(req, res) {
    let data = req.body,
        session = req.session;
    if (!session.user_id)
        return res.status(INVALID.e_code).send("Login required");
    validateRequestFromFloID({
        type: "deposit_Rupee",
        txid: data.txid,
        timestamp: data.timestamp
    }, data.sign, session.user_id).then(req_str => {
        market.depositRupee(session.user_id, data.txid).then(result => {
            storeRequest(session.user_id, req_str, data.sign);
            res.send(result);
        }).catch(error => {
            if (error instanceof INVALID)
                res.status(INVALID.e_code).send(error.message);
            else {
                console.error(error);
                res.status(INTERNAL.e_code).send("Request processing failed! Try again later!");
            }
        });
    }).catch(error => {
        if (error instanceof INVALID)
            res.status(INVALID.e_code).send(error.message);
        else {
            console.error(error);
            res.status(INTERNAL.e_code).send("Request processing failed! Try again later!");
        }
    });
}

function WithdrawRupee(req, res) {
    let data = req.body,
        session = req.session;
    if (!session.user_id)
        return res.status(INVALID.e_code).send("Login required");
    validateRequestFromFloID({
        type: "withdraw_Rupee",
        amount: data.amount,
        timestamp: data.timestamp
    }, data.sign, session.user_id).then(req_str => {
        market.withdrawRupee(session.user_id, data.amount).then(result => {
            storeRequest(session.user_id, req_str, data.sign);
            res.send(result);
        }).catch(error => {
            if (error instanceof INVALID)
                res.status(INVALID.e_code).send(error.message);
            else {
                console.error(error);
                res.status(INTERNAL.e_code).send("Request processing failed! Try again later!");
            }
        });
    }).catch(error => {
        if (error instanceof INVALID)
            res.status(INVALID.e_code).send(error.message);
        else {
            console.error(error);
            res.status(INTERNAL.e_code).send("Request processing failed! Try again later!");
        }
    });
}

function addUserTag(req, res) {
    let data = req.body,
        session = req.session;
    if (!session.user_id)
        return res.status(INVALID.e_code).send("Login required");
    else if (!trustedIDs.includes(session.user_id))
        return res.status(INVALID.e_code).send("Access Denied");
    validateRequestFromFloID({
        command: "add_Tag",
        user: data.user,
        tag: data.tag,
        timestamp: data.timestamp
    }, data.sign, session.user_id).then(req_str => {
        market.group.addTag(data.user, data.tag).then(result => {
            storeRequest(session.user_id, req_str, data.sign);
            res.send(result);
        }).catch(error => {
            if (error instanceof INVALID)
                res.status(INVALID.e_code).send(error.message);
            else {
                console.error(error);
                res.status(INTERNAL.e_code).send("Request processing failed! Try again later!");
            }
        });
    }).catch(error => {
        if (error instanceof INVALID)
            res.status(INVALID.e_code).send(error.message);
        else {
            console.error(error);
            res.status(INTERNAL.e_code).send("Request processing failed! Try again later!");
        }
    });
}

function removeUserTag(req, res) {
    let data = req.body,
        session = req.session;
    if (!session.user_id)
        return res.status(INVALID.e_code).send("Login required");
    else if (!trustedIDs.includes(session.user_id))
        return res.status(INVALID.e_code).send("Access Denied");
    else
        validateRequestFromFloID({
            command: "remove_Tag",
            user: data.user,
            tag: data.tag,
            timestamp: data.timestamp
        }, data.sign, session.user_id).then(req_str => {
            market.group.removeTag(data.user, data.tag).then(result => {
                storeRequest(session.user_id, req_str, data.sign);
                res.send(result);
            }).catch(error => {
                if (error instanceof INVALID)
                    res.status(INVALID.e_code).send(error.message);
                else {
                    console.error(error);
                    res.status(INTERNAL.e_code).send("Request processing failed! Try again later!");
                }
            });
        }).catch(error => {
            if (error instanceof INVALID)
                res.status(INVALID.e_code).send(error.message);
            else {
                console.error(error);
                res.status(INTERNAL.e_code).send("Request processing failed! Try again later!");
            }
        });
}

module.exports = {
    SignUp,
    Login,
    Logout,
    PlaceBuyOrder,
    PlaceSellOrder,
    CancelOrder,
    ListSellOrders,
    ListBuyOrders,
    ListTransactions,
    getRate,
    Account,
    DepositFLO,
    WithdrawFLO,
    DepositRupee,
    WithdrawRupee,
    periodicProcess: market.periodicProcess,
    addUserTag,
    removeUserTag,
    set trustedIDs(ids) {
        trustedIDs = ids;
    },
    set DB(db) {
        DB = db;
        market.DB = db;
    }
};