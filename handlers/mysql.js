const mysql = require('mysql2/promise');
const { mysqlConfig } = require('../config.js');

// MySQL接続情報
const connectionString = {
      host: mysqlConfig.HOST
    , port: mysqlConfig.PORT
    , database: mysqlConfig.DATABASE
    , user: mysqlConfig.USER
    , password: mysqlConfig.PASSWORD
    , dateStrings: 'date' /*または'true'*/
};
exports.database = connectionString.database;

// コネクションプールの取得
const pool = mysql.createPool(connectionString);
const connect = pool.getConnection()
exports.connect = connect;


// Database から データを取得する
const getDatabase = async (sql, param) => {
    const conn = await pool.getConnection();
    const results = await conn.query(sql, param);
    conn.release();
    return JSON.parse(JSON.stringify(results[0]));;
};

// ユーザー情報の取得
const getM0010 = async (userid) => {
    const sql = "select TANNM, PASSWD from m0010 where TANCD=?"
    return getDatabase(sql, [userid]);
};
exports.getM0010 = getM0010;

// 今週月曜日から来週金曜日までの営業日を取得
const getYMDs = async () => {
    const sql = 
        "select YMD from (select DATE_FORMAT(YMD,'%Y-%m-%d') 'YMD' from s0820 where CALTYP='00001' and WKKBN='1' and YMD between " +
        "(CURRENT_DATE - interval WEEKDAY(CURRENT_DATE) day) " + 
        "and " + 
        "(CURRENT_DATE - interval WEEKDAY(CURRENT_DATE) day + interval 30 day)) T limit 10"
    const ymdobj = await getDatabase(sql, []);
    const ymd = [];
    for (let row of ymdobj) {ymd.push(row.YMD)};
    return ymd;
};
exports.getYMDs = getYMDs;

// 炉中洩れ検査日報取得
exports.getKD8220 = async (date, odcd, disp) => {
    const odcdlike = odcd + "%";
    let orderby = "";
    switch(disp){
        case "1":
            orderby = "order by a.INSTDT asc";
            break;
        case "2":
            orderby = "order by a.INSTDT desc";
            break;
        case "3":
            orderby = "order by a.HMCD asc";
            break;
        case "4":
            orderby = "order by a.HMCD desc";
            break;
        case "5":
            orderby = "order by a.OPERATOR asc";
            break;
        case "6":
            orderby = "order by a.OPERATOR desc";
            break;                         
    }
    const kd8220 = await getDatabase(
        "select a.*, ifnull(b.TKRNM, '-') as 'TKRNM', NAME as 'OPNAME' " + 
        "from kd8220 a left outer join m0200 b on a.TKCD=b.TKCD, km0010 c " +
        "where a.OPERATOR=c.EMPNO and ENTRYDT=? and ODCD like ? " + orderby
        , [date, odcdlike]
    );
    return kd8220;
};

// iPhone表示用の日報データ取得
exports.getKD8220iPhone = async (date, entryplace) => {
    let odcd = "";
    if (entryplace == "WL04") {
        odcd = "607%";
    } else if (entryplace == "WL01") {
        odcd = "605%";
    }
    const kd8220 = await getDatabase(
        "select a.*, ifnull(b.TKRNM, '-') as 'TKRNM', NAME as 'OPNAME' " + 
        "from kd8220 a left outer join m0200 b on a.TKCD=b.TKCD, km0010 c " +
        "where a.ODCD like '" + odcd + "' and a.OPERATOR=c.EMPNO and ENTRYDT=? order by a.HMCD"
        , [date]
    );
    return kd8220;
};

// 従業員マスタ(KM0010)存在チェック
exports.isKM0010 = async (userid) => {
    const km0010 = await getDatabase("select * from km0010 where EMPNO=?", [userid]);
    return km0010.length == 0 ? false : true;
};

// 品目マスタ(M0500)存在チェック
exports.isM0500 = async (hmcd) => {
    const m0500 = await getDatabase("select * from m0500 where HMCD=?", [hmcd]);
    return m0500.length == 0 ? false : true;
};

// 出荷指示書ファイルより概要取得
exports.getKD8330overview = async (today) => {
    const kd8330 = await getDatabase(
        "select " +
        "	a.TKCD, replace(b.TKRNM,'ｸﾎﾞﾀ','') as 'TKRNM', a.SHIPDT, a.DLVRDT, a.XLSSN" +
        "	, count(distinct a.TKHMCD) as 'TTL' " +
        "   , count(distinct d.TKHMCD) as 'CNT' " +
        "from kd8330 a left outer join kd8330 d on " +
        "     d.TKCD=a.TKCD and d.SHIPDT=a.SHIPDT and d.DLVRDT=a.DLVRDT and d.XLSSN=a.XLSSN and d.ODRQTY=d.HTJUQTY" +
        "   , m0200 b " +
        "where a.TKCD=b.TKCD and " +
        "a.shipdt>=date(?) " +
        "group by " +
        "	a.TKCD, b.TKRNM, a.SHIPDT, a.DLVRDT, a.XLSSN"
        , [today]
    );
    return kd8330;
};

// 出荷指示書ファイル明細より出荷予定点数取得
exports.getKD8330ttlcount = async (tkcd, shipdt, xlssn) => {
    const kd8330 = await getDatabase(
        "select count(distinct a.TKHMCD) as 'TTL' from kd8330 a " +
        "where a.tkcd=? and a.shipdt>=date(?) and a.xlssn=?"
        , [tkcd, shipdt, xlssn]
    );
    return  Number(kd8330[0].TTL);
};

// 出荷指示書ファイル明細より出荷点数取得
exports.getKD8330count = async (tkcd, shipdt, xlssn) => {
    const kd8330 = await getDatabase(
        "select count(distinct a.TKHMCD) as 'TTL' from kd8330 a " +
        "where a.ODRQTY=a.HTJUQTY and a.tkcd=? and a.shipdt>=date(?) and a.xlssn=?"
        , [tkcd, shipdt, xlssn]
    );
    return Number(kd8330[0].TTL);
};

// 出荷指示書ファイル明細取得
exports.getKD8330detail = async (tkcd, shipdt, xlssn, disp) => {
    const kd8330 = await getDatabase(
        "select a.*, b.TKRNM, c.NAME as 'HTTANNM', d.PODRNM AS 'YPODRNM', d.ODRNM AS 'YODRNM' " + 
        ", d.PKZAIQTY, d.PJIDT, d.PJIQTY, d.PLNQTY, d.ZAIQTY, d.KZAIQTY, d.JIDT, d.JIQTY " + 
        "from kd8330 a left outer join km0010 c on trim(a.HTTANCD)=c.EMPNO " + 
        "left outer join kd8010 d on d.HMCD in (a.TKHMCD, a.HMCD) and d.OPDATE=?, m0200 b " + 
        "where a.TKCD=b.TKCD and a.tkcd=? and a.shipdt>=date(?) and a.xlssn=?"
        , [shipdt, tkcd, shipdt, xlssn]
    );
    return kd8330;
};

// 出荷指示書の対象Page情報を取得
const getKD8330Pages = async (tkcd) => {
    const sql = "select DATE_FORMAT(SHIPDT, '%Y-%m-%d') as 'SHIPDT',XLSSN from kd8330 " + 
        "where TKCD=? and SHIPDT > date_add(curdate(), interval -1 day) group by SHIPDT,XLSSN"
    const arrayobj = await getDatabase(sql, [tkcd]);
    const array = [];
    for (let row of arrayobj) {array.push(row.SHIPDT + ":" + row.XLSSN + ":")};
    return array;
};
exports.getKD8330Pages = getKD8330Pages;

// [MySQL] 品目手順マスタと工程ごとの在庫数を取得する API (MySQL Version D0520作成すれば動作する)
const getM0510zai = async (hmcd) => {
    const sql = 
        "select * from (" + 
        "select null as HMNM, a.KTSEQ, a.KTCD, k.KTNM, a.ODCD, o.ODRNM, a.JIKBN" + 
        ", a.WKNOTE, a.WKCOMMENT, ifnull(z.ZAIQTY,0) as 'ZAIQTY' " + 
        "from M0510 a left join D0520 z on a.HMCD=z.HMCD and a.KTCD=z.KTCD, M0410 k, M0300 o " + 
        "where a.KTCD=k.KTCD and a.ODCD=o.ODCD " +
        "and a.VALDTF=(select max(tmp.VALDTF) from M0510 tmp where tmp.HMCD=a.HMCD) " + 
        "and mod(a.KTSEQ, 10) = 0 " + 
        "and a.HMCD=? " + 
        "order by a.HMCD, a.KTSEQ DESC" + 
        ") res limit 5"
        const m0510zai = await getDatabase(sql, [hmcd]);
    return m0510zai;
};
exports.getM0510zai = getM0510zai;

// [MySQL] 品目マスタの品名と最終工程の在庫数を取得する API (MySQL Version D0520作成すれば動作する)
// D0520:在庫Fは最終工程コードがnullで品目手順マスタからでは取得できない為
const getM0500zai = async (hmcd) => {
    const sql = 
        "select m.HMNM, z.ZAIQTY from M0500 m, D0520 z where m.HMCD=z.HMCD and z.KTCD is NULL " + 
        "and m.HMCD=?";
    const m0500zai = await getDatabase(sql, [hmcd]);
    return m0500zai;
};
exports.getM0500zai = getM0500zai;
