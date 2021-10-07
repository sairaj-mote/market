const express = require('express');
const cookieParser = require("cookie-parser");
const sessions = require('express-session');
const Request = require('./request');

const REFRESH_INTERVAL = 60 * 1000; //1 min

module.exports = function App(secret, DB) {

    const app = express();
    //session middleware
    app.use(sessions({
        secret: secret,
        saveUninitialized: true,
        resave: false,
        name: "session"
    }));
    // parsing the incoming data
    app.use(express.json());
    app.use(express.urlencoded({
        extended: true
    }));
    //serving public file
    app.use(express.static(PUBLIC_DIR));
    // cookie parser middleware
    app.use(cookieParser());

    //Initital page loading
    app.get('/', (req, res) => res.sendFile('home.html', {
        root: PUBLIC_DIR
    }));

    //signup request
    app.post('/signup', Request.SignUp);

    //login request
    app.post('/login', Request.Login);

    //logout request
    app.get('/logout', Request.Logout);

    //place sell or buy order
    app.post('/buy', Request.PlaceBuyOrder);
    app.post('/sell', Request.PlaceSellOrder);

    //cancel sell or buy order
    app.post('/cancel', Request.CancelOrder);

    //list sell or buy order
    app.get('/list-sellorders', Request.ListSellOrders);
    app.get('/list-buyorders', Request.ListBuyOrders);

    //list all process transactions and rate
    app.get('/list-transactions', Request.ListTransactions);
    app.get('/get-rate', Request.getRate)

    //get account details
    app.get('/account', Request.Account);

    //withdraw and deposit request
    app.post('/deposit-flo', Request.DepositFLO);
    app.post('/withdraw-flo', Request.WithdrawFLO);
    app.post('/deposit-rupee', Request.DepositRupee);
    app.post('/withdraw-rupee', Request.WithdrawRupee);

    Request.DB = DB;
    Request.periodicProcess();
    let refresher = setInterval(Request.periodicProcess, REFRESH_INTERVAL);
    return app;
}