'use strict';

/**
 * 用户站点：/<别名>/... —— 必须在 app.js 里最后挂载。
 * 前面任何一个平台路由没接住的请求才会落到这里。
 */

const express = require('express');
const router = express.Router();

const site = require('../lib/site');

router.use((req, res, next) => {
  site.handle(req, res, next).catch(next);
});

module.exports = router;
