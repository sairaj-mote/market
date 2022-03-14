'use strict';

const market = require("./market");

const {
    SIGN_EXPIRE_TIME,
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

function validateRequest(request, sign, floID, pubKey) {
    return new Promise((resolve, reject) => {
        if (!serving)
            reject(INVALID(INVALID_SERVER_MSG));
        else if (!request.timestamp)
            reject(INVALID("Timestamp parameter missing"));
        else if (Date.now() - SIGN_EXPIRE_TIME > request.timestamp)
            reject(INVALID("Signature Expired"));
        else if (!floCrypto.validateAddr(floID))
            reject(INVALID("Invalid floID"));
        else if (typeof request !== "object")
            reject(INVALID("Request is not an object"));
        else validateRequest.getSignKey(floID, pubKey).then(signKey => {
            let req_str = Object.keys(request).sort().map(r => r + ":" + request[r]).join("|");
            try {
                if (!floCrypto.verifySign(req_str, sign, signKey))
                    reject(INVALID("Invalid request signature! Re-login if this error occurs frequently"));
                else validateRequest.checkIfSignUsed(sign)
                    .then(result => resolve(req_str))
                    .catch(error => reject(error))
            } catch {
                reject(INVALID("Corrupted sign/key"));
            }
        }).catch(error => reject(error));
    });
}

validateRequest.getSignKey = (floID, pubKey) => new Promise((resolve, reject) => {
    if (!pubKey)
        DB.query("SELECT session_time, proxyKey FROM UserSession WHERE floID=?", [floID]).then(result => {
            if (result.length < 1)
                reject(INVALID("Session not active"));
            else if (proxy && result[0].session_time + MAX_SESSION_TIMEOUT < Date.now())
                reject(INVALID("Session Expired! Re-login required"));
            else
                resolve(result[0].proxyKey);
        }).catch(error => reject(error));
    else if (floCrypto.getFloID(pubKey) === floID)
        resolve(pubKey);
    else
        reject(INVALID("Invalid pubKey"));
});

validateRequest.checkIfSignUsed = sign => new Promise((resolve, reject) => {
    DB.query("SELECT id FROM RequestLog WHERE sign=?", [sign]).then(result => {
        if (result.length)
            reject(INVALID("Duplicate signature"));
        else
            resolve(true);
    }).catch(error => reject(error))
});

function storeRequest(floID, req_str, sign, proxy = false) {
    //console.debug(floID, req_str);
    DB.query("INSERT INTO RequestLog (floID, request, sign, proxy) VALUES (?,?,?, ?)", [floID, req_str, sign, proxy])
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

/*
function SignUp(req, res) {
    if (!serving)
        return res.status(INVALID.e_code).send(INVALID_SERVER_MSG);
    let data = req.body;
    if (floCrypto.getFloID(data.pubKey) !== data.floID)
        return res.status(INVALID.e_code).send("Invalid Public Key");
    if (!data.code || data.hash != Crypto.SHA1(data.code + secret))
        return res.status(INVALID.e_code).send("Invalid Code");
    let req_str = validateRequest_X({
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
*/

function Login(req, res) {
    let data = req.body;
    if (!data.code || data.hash != Crypto.SHA1(data.code + secret))
        return res.status(INVALID.e_code).send("Invalid Code");
    if (!data.pubKey)
        return res.status(INVALID.e_code).send("Public key missing");
    validateRequest({
        type: "login",
        random: data.code,
        proxyKey: data.proxyKey,
        timestamp: data.timestamp
    }, data.sign, data.floID, data.pubKey).then(req_str => {
        DB.query("INSERT INTO UserSession (floID, proxyKey) VALUE (?, ?) " +
            "ON DUPLICATE KEY UPDATE session_time=DEFAULT, proxyKey=?",
            [data.floID, data.proxyKey, data.proxyKey]).then(_ => {
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
    validateRequest({
        type: "logout",
        timestamp: data.timestamp
    }, data.sign, data.floID, data.pubKey).then(req_str => {
        DB.query("DELETE FROM UserSession WHERE floID=?", [data.floID]).then(_ => {
            storeRequest(data.floID, req_str, data.sign, !data.pubKey);
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
    validateRequest({
        type: "sell_order",
        asset: data.asset,
        quantity: data.quantity,
        min_price: data.min_price,
        timestamp: data.timestamp
    }, data.sign, data.floID, data.pubKey).then(req_str => {
        market.addSellOrder(data.floID, data.asset, data.quantity, data.min_price).then(result => {
            storeRequest(data.floID, req_str, data.sign, !data.pubKey);
            res.send(result);
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
    validateRequest({
        type: "buy_order",
        asset: data.asset,
        quantity: data.quantity,
        max_price: data.max_price,
        timestamp: data.timestamp
    }, data.sign, data.floID, data.pubKey).then(req_str => {
        market.addBuyOrder(data.floID, data.asset, data.quantity, data.max_price).then(result => {
            storeRequest(data.floID, req_str, data.sign, !data.pubKey);
            res.send(result);
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
    validateRequest({
        type: "cancel_order",
        order: data.orderType,
        id: data.orderID,
        timestamp: data.timestamp
    }, data.sign, data.floID, data.pubKey).then(req_str => {
        market.cancelOrder(data.orderType, data.orderID, data.floID).then(result => {
            storeRequest(data.floID, req_str, data.sign, !data.pubKey);
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

function TransferToken(req, res) {
    let data = req.body;
    validateRequest({
        type: "transfer_token",
        receiver: data.receiver,
        token: data.token,
        amount: data.amount,
        timestamp: data.timestamp
    }, data.sign, data.floID, data.pubKey).then(req_str => {
        market.transferToken(data.floID, data.receiver, data.token, data.amount).then(result => {
            storeRequest(data.floID, req_str, data.sign, !data.pubKey);
            res.send(result);
        }).catch(error => {
            if (error instanceof INVALID)
                res.status(INVALID.e_code).send(error.message);
            else {
                console.error(error);
                res.status(INTERNAL.e_code).send("Token Transfer failed! Try again later!");
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

function ListTradeTransactions(req, res) {
    //TODO: Limit size (recent)
    DB.query("SELECT * FROM TradeTransactions ORDER BY tx_time DESC")
        .then(result => res.send(result))
        .catch(error => res.status(INTERNAL.e_code).send("Try again later!"));
}

function getRates(req, res) {
    if (!serving)
        res.status(INVALID.e_code).send(INVALID_SERVER_MSG);
    else {
        let asset = req.query.asset,
            rates = market.rates;
        if (asset) {
            if (asset in rates)
                res.send(rates[asset]);
            else
                res.status(INVALID.e_code).send("Invalid asset parameter");
        } else
            res.send(rates);
    }

}

function getTransaction(req, res) {
    if (!serving)
        res.status(INVALID.e_code).send(INVALID_SERVER_MSG);
    else {
        let txid = req.query.txid;
        if (!txid)
            res.status(INVALID.e_code).send("txid (transactionID) parameter missing");
        market.getTransactionDetails(txid)
            .then(result => res.send(result))
            .catch(error => {
                if (error instanceof INVALID)
                    res.status(INVALID.e_code).send(error.message);
                else {
                    console.error(error);
                    res.status(INTERNAL.e_code).send("Unable to process! Try again later!");
                }
            });
    }
}

function Account(req, res) {
    let data = req.body;
    validateRequest({
        type: "get_account",
        timestamp: data.timestamp
    }, data.sign, data.floID, data.pubKey).then(req_str => {
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
    validateRequest({
        type: "deposit_flo",
        txid: data.txid,
        timestamp: data.timestamp
    }, data.sign, data.floID, data.pubKey).then(req_str => {
        market.depositFLO(data.floID, data.txid).then(result => {
            storeRequest(data.floID, req_str, data.sign, !data.pubKey);
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
    validateRequest({
        type: "withdraw_flo",
        amount: data.amount,
        timestamp: data.timestamp
    }, data.sign, data.floID, data.pubKey).then(req_str => {
        market.withdrawFLO(data.floID, data.amount).then(result => {
            storeRequest(data.floID, req_str, data.sign, !data.pubKey);
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
    validateRequest({
        type: "deposit_token",
        txid: data.txid,
        timestamp: data.timestamp
    }, data.sign, data.floID, data.pubKey).then(req_str => {
        market.depositToken(data.floID, data.txid).then(result => {
            storeRequest(data.floID, req_str, data.sign, !data.pubKey);
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
    validateRequest({
        type: "withdraw_token",
        token: data.token,
        amount: data.amount,
        timestamp: data.timestamp
    }, data.sign, data.floID, data.pubKey).then(req_str => {
        market.withdrawToken(data.floID, data.token, data.amount).then(result => {
            storeRequest(data.floID, req_str, data.sign, !data.pubKey);
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
        res.status(INVALID.e_code).send("Access Denied");
    else validateRequest({
        type: "add_tag",
        user: data.user,
        tag: data.tag,
        timestamp: data.timestamp
    }, data.sign, data.floID, data.pubKey).then(req_str => {
        market.group.addTag(data.user, data.tag).then(result => {
            storeRequest(data.floID, req_str, data.sign, !data.pubKey);
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
        res.status(INVALID.e_code).send("Access Denied");
    else validateRequest({
        type: "remove_tag",
        user: data.user,
        tag: data.tag,
        timestamp: data.timestamp
    }, data.sign, data.floID, data.pubKey).then(req_str => {
        market.group.removeTag(data.user, data.tag).then(result => {
            storeRequest(data.floID, req_str, data.sign, !data.pubKey);
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
    //SignUp,
    Login,
    Logout,
    PlaceBuyOrder,
    PlaceSellOrder,
    CancelOrder,
    TransferToken,
    ListSellOrders,
    ListBuyOrders,
    ListTradeTransactions,
    getRates,
    getTransaction,
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