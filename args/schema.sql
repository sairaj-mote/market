/* Blockchain Data */

CREATE TABLE LastTx(
    floID CHAR(34) NOT NULL,
    num INT,
    PRIMARY KEY(floID)
);

CREATE TABLE NodeList(
    floID CHAR(34) NOT NULL, 
    uri TINYTEXT,
    PRIMARY KEY(floID)
);

CREATE TABLE TagList (
    tag VARCHAR(50) NOT NULL,
    sellPriority INT,
    buyPriority INT,
    api TINYTEXT,
    PRIMARY KEY(tag)
);

CREATE TABLE AssetList (
    asset VARCHAR(64) NOT NULL,
    initialPrice FLOAT,
    PRIMARY KEY(asset)
);

CREATE TABLE TrustedList(
    floID CHAR(34) NOT NULL,
    PRIMARY KEY(floID)
);

/* User Data */

CREATE TABLE Users (
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    pubKey CHAR(66) NOT NULL,
    created DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY(id),
    PRIMARY KEY(floID)
);

CREATE TABLE UserSession (
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    proxyKey CHAR(66) NOT NULL,
    session_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY (id),
    PRIMARY KEY(floID),
    FOREIGN KEY (floID) REFERENCES Users(floID)
);

CREATE TABLE Cash (
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL UNIQUE,
    balance DECIMAL(12, 2) DEFAULT 0.00,
    PRIMARY KEY(id),
    FOREIGN KEY (floID) REFERENCES Users(floID)
);

CREATE TABLE Vault (
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    locktime DATETIME DEFAULT CURRENT_TIMESTAMP,
    asset VARCHAR(64) NOT NULL,
    base DECIMAL(10, 2),
    quantity FLOAT NOT NULL,
    PRIMARY KEY(id),
    FOREIGN KEY (floID) REFERENCES Users(floID),
    FOREIGN KEY (asset) REFERENCES AssetList(asset)
);

CREATE TABLE UserTag (
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    tag VARCHAR(50) NOT NULL,
    PRIMARY KEY(floID, tag),
    KEY (id),
    FOREIGN KEY (floID) REFERENCES Users(floID),
    FOREIGN KEY (tag) REFERENCES TagList(tag)
);

/* User Requests */

CREATE TABLE RequestLog(
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    request TEXT NOT NULL,
    sign TEXT NOT NULL,
    request_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(id),
    FOREIGN KEY (floID) REFERENCES Users(floID)
);

CREATE TABLE SellOrder (
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    asset VARCHAR(64) NOT NULL,
    quantity FLOAT NOT NULL,
    minPrice DECIMAL(10, 2) NOT NULL,
    time_placed DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(id),
    FOREIGN KEY (floID) REFERENCES Users(floID),
    FOREIGN KEY (asset) REFERENCES AssetList(asset)
);

CREATE TABLE BuyOrder (
    id INT NOT NULL AUTO_INCREMENT,
    floID CHAR(34) NOT NULL,
    asset VARCHAR(64) NOT NULL,
    quantity FLOAT NOT NULL,
    maxPrice DECIMAL(10, 2) NOT NULL,
    time_placed DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(id),
    FOREIGN KEY (floID) REFERENCES Users(floID),
    FOREIGN KEY (asset) REFERENCES AssetList(asset)
);

CREATE TABLE InputFLO (
    id INT NOT NULL AUTO_INCREMENT,
    txid VARCHAR(128) NOT NULL,
    floID CHAR(34) NOT NULL,
    amount FLOAT,
    status VARCHAR(50) NOT NULL,
    PRIMARY KEY(id),
    FOREIGN KEY (floID) REFERENCES Users(floID)
);

CREATE TABLE OutputFLO (
    id INT NOT NULL AUTO_INCREMENT,
    txid VARCHAR(128),
    floID CHAR(34) NOT NULL,
    amount FLOAT NOT NULL,
    status VARCHAR(50) NOT NULL,
    PRIMARY KEY(id),
    FOREIGN KEY (floID) REFERENCES Users(floID)
);

CREATE TABLE InputToken (
    id INT NOT NULL AUTO_INCREMENT,
    txid VARCHAR(128) NOT NULL,
    floID CHAR(34) NOT NULL,
    token VARCHAR(64),
    amount FLOAT,
    status VARCHAR(50) NOT NULL,
    PRIMARY KEY(id),
    FOREIGN KEY (floID) REFERENCES Users(floID)
);

CREATE TABLE OutputToken (
    id INT NOT NULL AUTO_INCREMENT,
    txid VARCHAR(128),
    floID CHAR(34) NOT NULL,
    token VARCHAR(64),
    amount FLOAT NOT NULL,
    status VARCHAR(50) NOT NULL,
    PRIMARY KEY(id),
    FOREIGN KEY (floID) REFERENCES Users(floID)
);

/* Transaction Data */

CREATE TABLE PriceHistory (
    id INT NOT NULL AUTO_INCREMENT,
    asset VARCHAR(64) NOT NULL,
    rate FLOAT NOT NULL,
    rec_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(id),
    FOREIGN KEY (asset) REFERENCES AssetList(asset)
);

CREATE TABLE TransactionHistory (
    id INT NOT NULL AUTO_INCREMENT,
    seller CHAR(34) NOT NULL,
    buyer CHAR(34) NOT NULL,
    asset VARCHAR(64) NOT NULL,
    quantity FLOAT NOT NULL,
    unitValue DECIMAL(10, 2) NOT NULL,
    tx_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(id),
    FOREIGN KEY (buyer) REFERENCES Users(floID),
    FOREIGN KEY (seller) REFERENCES Users(floID),
    FOREIGN KEY (asset) REFERENCES AssetList(asset)
);

CREATE TABLE AuditTransaction(
    id INT NOT NULL AUTO_INCREMENT,
    rec_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    unit_price FLOAT NOT NULL,
    quantity FLOAT NOT NULL,
    total_cost FLOAT NOT NULL,
    asset VARCHAR(64) NOT NULL,
    sellerID CHAR(34) NOT NULL,
    seller_old_asset FLOAT NOT NULL,
    seller_new_asset FLOAT NOT NULL,
    seller_old_cash FLOAT NOT NULL,
    seller_new_cash FLOAT NOT NULL,
    buyerID CHAR(34) NOT NULL,
    buyer_old_asset FLOAT NOT NULL,
    buyer_new_asset FLOAT NOT NULL,
    buyer_old_cash FLOAT NOT NULL,
    buyer_new_cash FLOAT NOT NULL,
    PRIMARY KEY(id),
    FOREIGN KEY (sellerID) REFERENCES Users(floID),
    FOREIGN KEY (buyerID) REFERENCES Users(floID),
    FOREIGN KEY (asset) REFERENCES AssetList(asset)
);

/* Backup Feature (Tables & Triggers) */

CREATE TABLE _backup (
    t_name VARCHAR(20),
    id INT,
    mode BOOLEAN DEFAULT TRUE,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(t_name, id)
);

CREATE table _backupCache(
    id INT AUTO_INCREMENT,
    t_name TINYTEXT,
    data_cache LONGTEXT,
    status BOOLEAN,
    PRIMARY KEY(id)
);

CREATE TABLE sinkShares(
    floID CHAR(34) NOT NULL,
    share TEXT,
    time_ DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(floID)
);

CREATE TRIGGER Users_I AFTER INSERT ON Users
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('Users', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER Users_U AFTER UPDATE ON Users
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('Users', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER Users_D AFTER DELETE ON Users
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('Users', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER RequestLog_I AFTER INSERT ON RequestLog
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('RequestLog', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER RequestLog_U AFTER UPDATE ON RequestLog
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('RequestLog', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER RequestLog_D AFTER DELETE ON RequestLog
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('RequestLog', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER UserSession_I AFTER INSERT ON UserSession
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserSession', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER UserSession_U AFTER UPDATE ON UserSession
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserSession', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER UserSession_D AFTER DELETE ON UserSession
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserSession', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER Cash_I AFTER INSERT ON Cash
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('Cash', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER Cash_U AFTER UPDATE ON Cash
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('Cash', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER Cash_D AFTER DELETE ON Cash
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('Cash', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER Vault_I AFTER INSERT ON Vault
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('Vault', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER Vault_U AFTER UPDATE ON Vault
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('Vault', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER Vault_D AFTER DELETE ON Vault
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('Vault', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER SellOrder_I AFTER INSERT ON SellOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('SellOrder', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER SellOrder_U AFTER UPDATE ON SellOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('SellOrder', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER SellOrder_D AFTER DELETE ON SellOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('SellOrder', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER BuyOrder_I AFTER INSERT ON BuyOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('BuyOrder', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER BuyOrder_U AFTER UPDATE ON BuyOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('BuyOrder', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER BuyOrder_D AFTER DELETE ON BuyOrder
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('BuyOrder', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER InputFLO_I AFTER INSERT ON InputFLO
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('InputFLO', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER InputFLO_U AFTER UPDATE ON InputFLO
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('InputFLO', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER InputFLO_D AFTER DELETE ON InputFLO
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('InputFLO', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER OutputFLO_I AFTER INSERT ON OutputFLO
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('OutputFLO', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER OutputFLO_U AFTER UPDATE ON OutputFLO
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('OutputFLO', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER OutputFLO_D AFTER DELETE ON OutputFLO
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('OutputFLO', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER InputToken_I AFTER INSERT ON InputToken
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('InputToken', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER InputToken_U AFTER UPDATE ON InputToken
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('InputToken', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER InputToken_D AFTER DELETE ON InputToken
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('InputToken', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER OutputToken_I AFTER INSERT ON OutputToken
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('OutputToken', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER OutputToken_U AFTER UPDATE ON OutputToken
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('OutputToken', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER OutputToken_D AFTER DELETE ON OutputToken
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('OutputToken', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER UserTag_I AFTER INSERT ON UserTag
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserTag', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER UserTag_U AFTER UPDATE ON UserTag
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserTag', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER UserTag_D AFTER DELETE ON UserTag
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('UserTag', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER PriceHistory_I AFTER INSERT ON PriceHistory
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('PriceHistory', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER PriceHistory_U AFTER UPDATE ON PriceHistory
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('PriceHistory', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER PriceHistory_D AFTER DELETE ON PriceHistory
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('PriceHistory', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER AuditTransaction_I AFTER INSERT ON AuditTransaction
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('AuditTransaction', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER AuditTransaction_U AFTER UPDATE ON AuditTransaction
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('AuditTransaction', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER AuditTransaction_D AFTER DELETE ON AuditTransaction
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('AuditTransaction', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;

CREATE TRIGGER TransactionHistory_I AFTER INSERT ON TransactionHistory
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('TransactionHistory', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER TransactionHistory_U AFTER UPDATE ON TransactionHistory
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('TransactionHistory', NEW.id) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=DEFAULT;
CREATE TRIGGER TransactionHistory_D AFTER DELETE ON TransactionHistory
FOR EACH ROW INSERT INTO _backup (t_name, id) VALUES ('TransactionHistory', OLD.id) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=DEFAULT;
