const market = require("./market");
var DB; //container for database

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

function SignUp(req, res) {
    let data = req.body,
        session = req.session;
    console.debug(session.random, data);
    if (floCrypto.getFloID(data.pubKey) !== data.floID)
        res.status(INVALID.e_code).send("Invalid Public Key");
    if (!session.random)
        res.status(INVALID.e_code).send("Invalid Session");
    else if (!floCrypto.verifySign(session.random, data.sign, data.pubKey))
        res.status(INVALID.e_code).send("Invalid Signature");
    else {
        DB.query("INSERT INTO Users(floID, pubKey, session_time) VALUES (?, ?, NULL)", [data.floID, data.pubKey])
            .then(_ => res.send("Account Created")).catch(error => {
                console.error(error);
                res.status(INTERNAL.e_code).send("Account creation failed! Try Again Later!");
            });
    }
}

function Login(req, res) {
    let data = req.body,
        session = req.session;
    if (floCrypto.getFloID(data.pubKey) !== data.floID)
        res.status(INVALID.e_code).send("Invalid Public Key");
    if (!session.random)
        res.status(INVALID.e_code).send("Invalid Session");
    else if (!floCrypto.verifySign(session.random, data.sign, data.pubKey))
        res.status(INVALID.e_code).send("Invalid Signature");
    else {
        if (data.saveSession) {
            DB.query("UPDATE Users SET session_id=?, session_time=DEFAULT WHERE floID=?", [req.sessionID, data.floID])
                .then(_ => session.cookie.maxAge = maxSessionTimeout)
                .catch(e => console.error(e)).finally(_ => {
                    session.user_id = data.floID;
                    res.send("Login Successful");
                });
        } else {
            session.user_id = data.floID;
            res.send("Login Successful");
        }
    }
}

function Logout(req, res) {
    let session = req.session;
    DB.query("UPDATE Users SET session_id=NULL, session_time=NULL WHERE floID=?", [session.user_id])
        .then(_ => null).catch(e => console.log(e)).finally(_ => {
            session.destroy();
            res.send('Logout successful')
        });
}

function PlaceSellOrder(req, res) {
    let data = req.body,
        session = req.session;
    market.addSellOrder(session.user_id, data.quantity, data.min_price)
        .then(result => res.send('Sell Order placed successfully'))
        .catch(error => {
            console.error(error);
            if (error instanceof INVALID)
                res.status(INVALID.e_code).send(error.message);
            else
                res.status(INTERNAL.e_code).send("Order placement failed! Try again later!");
        });
}

function PlaceBuyOrder(req, res) {
    let data = req.body,
        session = req.session;
    market.addBuyOrder(session.user_id, data.quantity, data.max_price)
        .then(result => res.send('Buy Order placed successfully'))
        .catch(error => {
            console.error(error);
            if (error instanceof INVALID)
                res.status(INVALID.e_code).send(error.message);
            else
                res.status(INTERNAL.e_code).send("Order placement failed! Try again later!");
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
        DB.query("SELECT session_id, session_time FROM Users WHERE floID=?", [req.session.user_id]).then(result => {
            let {
                session_id,
                session_time
            } = result.pop();
            if (!session_id || session_id != req.sessionID || session_time + maxSessionTimeout < Date.now())
                setLogin("Session Expired! Re-login required");
            else {
                let floID = req.session.user_id;
                res.cookie('floID', floID);
                market.getAccountDetails(floID)
                    .then(result => res.send(result));
            }
        }).catch(_ => res.status(INTERNAL.e_code).send("Try again later!"));
    }
}

module.exports = {
    SignUp,
    Login,
    Logout,
    PlaceBuyOrder,
    PlaceSellOrder,
    ListSellOrders,
    ListBuyOrders,
    ListTransactions,
    Account,
    set DB(db) {
        DB = db;
        market.DB = db;
    }
};