'use strict';

const market = require("./market");

const {
    MAX_SESSION_TIMEOUT,
    INVALID_SERVER_MSG
} = require("./_constants")["request"];

var DB, trustedIDs, secret; //container for database

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

var serving;

function validateRequestFromFloID(request, sign, floID, proxy = true) {
    return new Promise((resolve, reject) => {
        if (!serving)
            return reject(INVALID(INVALID_SERVER_MSG));
        else if (!floCrypto.validateAddr(floID))
            return reject(INVALID("Invalid floID"));
        DB.query("SELECT " + (proxy ? "session_time, proxyKey AS pubKey FROM UserSession" : "pubKey FROM Users") + " WHERE floID=?", [floID]).then(result => {
            if (result.length < 1)
                return reject(INVALID(proxy ? "Session not active" : "User not registered"));
            if (proxy && result[0].session_time + MAX_SESSION_TIMEOUT < Date.now())
                return reject(INVALID("Session Expired! Re-login required"));
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
    DB.query("INSERT INTO RequestLog (floID, request, sign) VALUES (?,?,?)", [floID, req_str, sign])
        .then(_ => null).catch(error => console.error(error));
}

function getLoginCode(req, res) {
    if (!serving)
        return res.status(INVALID.e_code).send(INVALID_SERVER_MSG);
    let randID = floCrypto.randString(8, true) + Math.round(Date.now() / 1000);
    let hash = Crypto.SHA1(randID + secret);
    res.send({
        code: randID,
        hash: hash
    });
}

function SignUp(req, res) {
    if (!serving)
        return res.status(INVALID.e_code).send(INVALID_SERVER_MSG);
    let data = req.body;
    if (floCrypto.getFloID(data.pubKey) !== data.floID)
        return res.status(INVALID.e_code).send("Invalid Public Key");
    if (!data.code || data.hash != Crypto.SHA1(data.code + secret))
        return res.status(INVALID.e_code).send("Invalid Code");
    let req_str = validateRequest({
        type: "create_account",
        random: data.code,
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
    let data = req.body;
    if (!data.code || data.hash != Crypto.SHA1(data.code + secret))
        return res.status(INVALID.e_code).send("Invalid Code");
    validateRequestFromFloID({
        type: "login",
        random: data.code,
        proxyKey: data.proxyKey,
        timestamp: data.timestamp
    }, data.sign, data.floID, false).then(req_str => {
        DB.query("INSERT INTO UserSession (floID, proxyKey) VALUE (?, ?) AS new " +
            "ON DUPLICATE KEY UPDATE session_time=DEFAULT, proxyKey=new.proxyKey",
            [data.floID, data.proxyKey]).then(_ => {
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
    let data = req.body;
    validateRequestFromFloID({
        type: "logout",
        timestamp: data.timestamp
    }, data.sign, data.floID).then(req_str => {
        DB.query("DELETE FROM UserSession WHERE floID=?", [data.floID]).then(_ => {
            storeRequest(data.floID, req_str, data.sign);
            res.send('Logout successful');
        }).catch(error => {
            console.error(error);
            res.status(INTERNAL.e_code).send("Logout failed! Try again later! Contact support if this error occurs frequently");
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

function PlaceSellOrder(req, res) {
    let data = req.body;
    validateRequestFromFloID({
        type: "sell_order",
        asset: data.asset,
        quantity: data.quantity,
        min_price: data.min_price,
        timestamp: data.timestamp
    }, data.sign, data.floID).then(req_str => {
        market.addSellOrder(data.floID, data.asset, data.quantity, data.min_price)
            .then(result => {
                storeRequest(data.floID, req_str, data.sign);
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
    let data = req.body;
    validateRequestFromFloID({
        type: "buy_order",
        asset: data.asset,
        quantity: data.quantity,
        max_price: data.max_price,
        timestamp: data.timestamp
    }, data.sign, data.floID).then(req_str => {
        market.addBuyOrder(data.floID, data.asset, data.quantity, data.max_price)
            .then(result => {
                storeRequest(data.floID, req_str, data.sign);
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
    let data = req.body;
    validateRequestFromFloID({
        type: "cancel_order",
        order: data.orderType,
        id: data.orderID,
        timestamp: data.timestamp
    }, data.sign, data.floID).then(req_str => {
        market.cancelOrder(data.orderType, data.orderID, data.floID)
            .then(result => {
                storeRequest(data.floID, req_str, data.sign);
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
    DB.query("SELECT * FROM TransactionHistory ORDER BY tx_time DESC")
        .then(result => res.send(result))
        .catch(error => res.status(INTERNAL.e_code).send("Try again later!"));
}

function getRates(req, res) {
    if (!serving)
        res.status(INVALID.e_code).send(INVALID_SERVER_MSG);
    else
        res.send(market.rates);
}

function Account(req, res) {
    let data = req.body;
    validateRequestFromFloID({
        type: "get_account",
        timestamp: data.timestamp
    }, data.sign, data.floID).then(req_str => {
        market.getAccountDetails(data.floID).then(result => {
            result.sinkID = global.sinkID;
            if (trustedIDs.includes(data.floID))
                result.subAdmin = true;
            res.send(result);
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

function DepositFLO(req, res) {
    let data = req.body;
    validateRequestFromFloID({
        type: "deposit_FLO",
        txid: data.txid,
        timestamp: data.timestamp
    }, data.sign, data.floID).then(req_str => {
        market.depositFLO(data.floID, data.txid).then(result => {
            storeRequest(data.floID, req_str, data.sign);
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
    let data = req.body;
    validateRequestFromFloID({
        type: "withdraw_FLO",
        amount: data.amount,
        timestamp: data.timestamp
    }, data.sign, data.floID).then(req_str => {
        market.withdrawFLO(data.floID, data.amount).then(result => {
            storeRequest(data.floID, req_str, data.sign);
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

function DepositToken(req, res) {
    let data = req.body;
    validateRequestFromFloID({
        type: "deposit_Token",
        txid: data.txid,
        timestamp: data.timestamp
    }, data.sign, data.floID).then(req_str => {
        market.depositToken(data.floID, data.txid).then(result => {
            storeRequest(data.floID, req_str, data.sign);
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

function WithdrawToken(req, res) {
    let data = req.body;
    validateRequestFromFloID({
        type: "withdraw_Token",
        token: data.token,
        amount: data.amount,
        timestamp: data.timestamp
    }, data.sign, data.floID).then(req_str => {
        market.withdrawToken(data.floID, data.token, data.amount).then(result => {
            storeRequest(data.floID, req_str, data.sign);
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
    let data = req.body;
    if (!trustedIDs.includes(data.floID))
        return res.status(INVALID.e_code).send("Access Denied");
    validateRequestFromFloID({
        command: "add_Tag",
        user: data.user,
        tag: data.tag,
        timestamp: data.timestamp
    }, data.sign, data.floID).then(req_str => {
        market.group.addTag(data.user, data.tag).then(result => {
            storeRequest(data.floID, req_str, data.sign);
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
    let data = req.body;
    if (!trustedIDs.includes(data.floID))
        return res.status(INVALID.e_code).send("Access Denied");
    else
        validateRequestFromFloID({
            command: "remove_Tag",
            user: data.user,
            tag: data.tag,
            timestamp: data.timestamp
        }, data.sign, data.floID).then(req_str => {
            market.group.removeTag(data.user, data.tag).then(result => {
                storeRequest(data.floID, req_str, data.sign);
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
    getLoginCode,
    SignUp,
    Login,
    Logout,
    PlaceBuyOrder,
    PlaceSellOrder,
    CancelOrder,
    ListSellOrders,
    ListBuyOrders,
    ListTransactions,
    getRates,
    Account,
    DepositFLO,
    WithdrawFLO,
    DepositToken,
    WithdrawToken,
    periodicProcess: market.periodicProcess,
    addUserTag,
    removeUserTag,
    set trustedIDs(ids) {
        trustedIDs = ids;
    },
    set assetList(assets) {
        market.assetList = assets;
    },
    set DB(db) {
        DB = db;
        market.DB = db;
    },
    set secret(s) {
        secret = s;
    },
    pause() {
        serving = false;
    },
    resume() {
        serving = true;
    }
};