module.exports = [
    { userId: "user01", password: "password", phone: "09011112222" },
    { userId: "user02", password: "password", phone: "09033334444" },
    { userId: "softbank_delivered", password: "password", phone: "09001111101" },
    { userId: "docomo_delivered", password: "password", phone: "09001111102" },
    { userId: "au_delivered", password: "password", phone: "09001111103" },
    { userId: "rakuten_delivered", password: "password", phone: "09001111104" },
    { userId: "softbank_unreachable", password: "password", phone: "09001111201" },
    { userId: "docomo_unreachable", password: "password", phone: "09001111202" },
    { userId: "au_unreachable", password: "password", phone: "09001111203" },
    { userId: "rakuten_unreachable", password: "password", phone: "09001111204" },
    { userId: "not_receivable", password: "password", phone: "09002222001" }
];

// 開発用電話番号
// 09001111101 softbank delivered
// 09001111102 docomo delivered
// 09001111103 au delivered
// 09001111104 rakuten delivered
// 09001111201 softbank failed DeviceUnreachable 端末が圏外か電源offの可能性があるため配信に失敗しました
// 09001111202 docomo failed DeviceUnreachable 端末が圏外か電源offの可能性があるため配信に失敗しました
// 09001111203 au failed DeviceUnreachable 端末が圏外か電源offの可能性があるため配信に失敗しました
// 09001111204 rakuten failed DeviceUnreachable 端末が圏外か電源offの可能性があるため配信に失敗しました
// 09002222001 unknown failed NotReceivableSMSNumber SMSが受信できない番号の可能性があるため配信に失敗しました
// test users for SMS delivery results