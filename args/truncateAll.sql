/* Node data */
TRUNCATE _backup;
TRUNCATE AuditTransaction;
TRUNCATE BuyOrder;
TRUNCATE Cash;
TRUNCATE InputFLO;
TRUNCATE InputToken;
TRUNCATE OutputFLO;
TRUNCATE OutputToken;
TRUNCATE PriceHistory;
TRUNCATE RequestLog;
TRUNCATE SellOrder;
TRUNCATE UserSession;
TRUNCATE UserTag;
TRUNCATE TransactionHistory;
TRUNCATE Vault;
DELETE FROM Users; 

/* Blockchain data */
TRUNCATE LastTx;
TRUNCATE NodeList;
TRUNCATE TrustedList;
DELETE FROM TagList;
DELETE FROM AssetList;