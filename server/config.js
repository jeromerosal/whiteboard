const config = {
    development: {
        port: 3000,
        path: "/",
        origin: "*",
        debug: true
    },
    production: {
        port: 4000,
        path: "/",
        origin: "*",
        debug: false
    }
};
module.exports = process.env.NODE_ENV === "development" ? config.development : config.production;