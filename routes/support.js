'use strict';

/**
 * 赞赏支持页 —— 平台自有页面，用平台样式。
 *
 * 所有登录用户可见（放在用户和管理员的侧边栏里），只有管理员能改说明文字。
 * 图片不归这里管：它们是 assets/donate/ 下的静态文件，经 /_assets 直接命中，
 * 所以这个页面本身没有静态中间件，也就没有绕开注入检查的风险。
 */

const express = require('express');
const router = express.Router();

const config = require('../lib/config');
const html = require('../lib/html');
const donate = require('../lib/donate');
const csrf = require('../lib/csrf');
const sessions = require('../lib/sessions');

const { escapeHtml } = html;

function gallery(images) {
  const items = images.map((img) => `<figure class="donate-item">
      <img class="donate-img" src="${escapeHtml(img.url)}" alt="${escapeHtml(img.title)}" loading="lazy">
      <figcaption class="donate-cap">${escapeHtml(img.title)}</figcaption>
    </figure>`).join('');

  return `<div class="donate-grid">${items}</div>`;
}

function emptyHint(isAdmin) {
  if (!isAdmin) return '<p class="muted">还没有设置赞赏码。</p>';

  return `<p class="muted small">
      还没有图片。把赞赏码（png / jpg / webp 等位图）放进服务器的
      <code>assets/donate/</code> 目录，刷新本页就会出现。
      文件名写成 <code>01-微信.png</code> 这样的形式，<code>01-</code> 用来排序，
      后半段作为标题显示。
    </p>`;
}

router.get('/', sessions.requireLogin, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const token = csrf.tokenFor(req.user);
  const images = donate.listImages();
  const note = donate.getNote();

  const noteHtml = note
    ? `<p class="donate-note">${escapeHtml(note)}</p>`
    : `<p class="muted">${isAdmin ? '还没有说明文字，在下面写一段吧。' : '谢谢你的支持。'}</p>`;

  const adminCard = !isAdmin ? '' : `<div class="card">
      <h2 class="card-title">编辑说明文字</h2>
      <form method="post" action="/support/note" class="form">
        ${html.csrfField(token)}
        <label class="field">说明文字
          <textarea name="note" rows="6" maxlength="${config.DONATE_NOTE_MAX}"
                    spellcheck="false" placeholder="写几句感谢的话，或说明这些码分别是什么">${escapeHtml(note)}</textarea>
          <span class="hint">纯文本，换行会原样保留。最多 ${config.DONATE_NOTE_MAX} 字。</span>
        </label>
        <button class="btn btn-primary" type="submit">保存</button>
      </form>
    </div>`;

  const body = `
    <div class="card">
      <h2 class="card-title">赞赏支持</h2>
      ${noteHtml}
      ${images.length ? gallery(images) : emptyHint(isAdmin)}
    </div>
    ${adminCard}`;

  return res.send(html.page({
    title: '赞赏支持',
    active: '/support',
    user: req.user,
    csrf: token,
    body,
  }));
});

router.post('/note', sessions.requireAdmin, async (req, res, next) => {
  try {
    await donate.setNote(req.body.note);
    return res.redirect('/support');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
