/* 用户后台：上传 zip（用 fetch/XHR 发原始字节，不走 multipart）+ 删除站点。 */

(function () {
  'use strict';

  var form = document.getElementById('upload-form');
  if (form) {
    var msgBox = document.getElementById('upload-msg');
    var submitBtn = form.querySelector('button[type="submit"]');
    var csrfToken = form.getAttribute('data-csrf') || '';
    var FOLDER_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;

    var show = function (kind, text) {
      msgBox.className = 'alert alert-' + kind;
      msgBox.textContent = text;
    };
    var reset = function () {
      submitBtn.disabled = false;
      submitBtn.textContent = '上传并解压';
    };

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var folder = form.folder.value.trim().toLowerCase();
      var file = form.file.files && form.file.files[0];

      if (!FOLDER_RE.test(folder)) {
        show('error', '文件夹名只能用小写字母、数字和短横线，1-31 位，且不能以短横线开头。');
        return;
      }
      if (!file) {
        show('error', '请先选择一个 zip 文件。');
        return;
      }

      // 直接把 File 当请求体，服务端 req 就是一条裸流 —— 不需要 multipart 解析器
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/dashboard/upload?folder=' + encodeURIComponent(folder));
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-CSRF-Token', csrfToken);
      xhr.setRequestHeader('Accept', 'application/json');

      submitBtn.disabled = true;
      submitBtn.textContent = '上传中…';

      xhr.upload.addEventListener('progress', function (progressEvent) {
        if (progressEvent.lengthComputable && progressEvent.total > 0) {
          var percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
          submitBtn.textContent = '上传中 ' + percent + '%';
        }
      });

      xhr.addEventListener('load', function () {
        var data = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch (e) {
          /* 非 JSON 响应，走下面的兜底文案 */
        }

        if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
          show('ok', '上传成功，解压出 ' + data.fileCount + ' 个文件。正在刷新…');
          setTimeout(function () {
            location.reload();
          }, 800);
          return;
        }

        reset();
        show('error', data.error || ('上传失败（HTTP ' + xhr.status + '）'));
      });

      xhr.addEventListener('error', function () {
        reset();
        show('error', '网络错误，上传未完成。');
      });

      xhr.send(file);
    });
  }

  // ------------------------------------------------------------ 删除站点

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    var button = target.closest('[data-delete-site]');
    if (!button) return;

    var folder = button.getAttribute('data-delete-site');

    var csrfField = document.querySelector('form[action="/dashboard/features"] input[name="_csrf"]');
    var csrfToken = csrfField ? csrfField.value : '';

    if (!window.confirm('确定删除文件夹 ' + folder + ' 及其全部文件？此操作不可撤销。')) return;

    button.disabled = true;
    button.textContent = '删除中…';

    fetch('/dashboard/sites/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        Accept: 'application/json',
      },
      body: JSON.stringify({ folder: folder }),
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok && result.data.ok) {
          location.reload();
          return;
        }
        button.disabled = false;
        button.textContent = '删除';
        if (window.toast) window.toast(result.data.error || '删除失败', 'error');
      })
      .catch(function () {
        button.disabled = false;
        button.textContent = '删除';
        if (window.toast) window.toast('网络错误，删除未完成', 'error');
      });
  });
})();
