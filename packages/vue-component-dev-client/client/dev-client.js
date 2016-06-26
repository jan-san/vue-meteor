
import {Vue} from 'meteor/akryum:vue';
import VueHotReloadApi from './vue-hot';
import {Reload} from 'meteor/reload';
import {Meteor} from 'meteor/meteor';
import {Tracker} from 'meteor/tracker';
import {Autoupdate} from 'meteor/autoupdate';
import {ReactiveVar} from 'meteor/reactive-var';

Vue.use(VueHotReloadApi);

// Hot reload API
window.__vue_hot__ = VueHotReloadApi;

// Records initialized before vue hot reload api
if(window.__vue_hot_pending__) {
  for(let hash in window.__vue_hot_pending__) {
    VueHotReloadApi.createRecord(hash, window.__vue_hot_pending__[hash]);
  }
}

// Reload override
var _suppressNextReload = false, _deferReload = 0;
var _reload = Reload._reload;
Reload._reload = function(options) {
  // Disable original reload for autoupdate package
  if(Reload._reload.caller.name !== 'checkNewVersionDocument') {
    _reload(options);
  }
}

// Custom reload method
function reload(options) {
  console.log('[HMR] Reload request received');
  if(_deferReload !== 0) {
    setTimeout(_reload, _deferReload);
    console.log(`[HMR] Client reload defered, will reload in ${_deferReload} ms`);
  } else if(_suppressNextReload) {
    console.log(`[HMR] Client version changed, reload suppressed because of previously hot-reloaded resource`);
  } else {
    console.log(`[HMR] Reloading app...`);
    _reload.call(Reload, options);
  }
  _suppressNextReload = false;
  _deferReload = 0;
}

// Reimplement client version check from autoupdate package
var autoupdateVersion = __meteor_runtime_config__.autoupdateVersion || `unknown`;
var ClientVersions = Autoupdate._ClientVersions;
function checkNewVersionDocument (doc) {
  if (doc._id === 'version' && doc.version !== autoupdateVersion) {
    reload();
  }
}
ClientVersions.find().observe({
  added: checkNewVersionDocument,
  changed: checkNewVersionDocument
});

// Hack https://github.com/socketio/socket.io-client/issues/961
import Response from 'meteor-node-stubs/node_modules/http-browserify/lib/response';
if(!Response.prototype.setEncoding) {
    Response.prototype.setEncoding = function(encoding){
        // do nothing
    }
}

Meteor.startup(function() {
  // Dev client
  let port = window.__hot_port__ || 3003;
  console.log('[HMR] Dev client port', port);
  let _socket = require('socket.io-client')(`http://localhost:${port}`);
  window.__dev_client__ = _socket;

  _socket.on('connect', function() {
    console.log('[HMR] Dev client connected');
  });
  _socket.on('disconnect', function() {
    console.log('[HMR] Dev client disconnected');
  });

  // JS
  _socket.on('js', Meteor.bindEnvironment(function({hash, js, template}) {
    _suppressNextReload = true;
    let args = ['meteor/akryum:vue'];
    let regResult;
    while(regResult = jsImportsReg.exec(js)) {
      args.push(regResult[2]);
    }
    args.push(function(require,exports,module){
      eval(js);
    });
    let id = `_component${(new Date()).getTime()}.js`;
    let require = meteorInstall({[id]:args});
    let result = require('./' + id);
    VueHotReloadApi.update(hash, result.default, template);
  }));

  // CSS
  let _styleNodes = {};
  _socket.on('css', function({hash, css}) {
    let style = _styleNodes[hash];
    if(!style) {
      style = document.createElement('style');
      document.getElementsByTagName('head')[0].appendChild(style);
      _styleNodes[hash] = style;
    }
    style.textContent = css;
  });

  // Locale
  _socket.on('lang.updated', function({lang, data}) {
    Vue.locale(lang, data);
    if(lang === Vue.config.lang) {
      // Refresh
      _suppressNextReload = true;
      VueHotReloadApi.updateWatchers();
    }
  });
  _socket.on('langs.updated', function({langs}) {
    _deferReload = 3000;
  });

  // Reg
  const jsImportsReg = /module\.import\((['"])(.+)\1/g;
})