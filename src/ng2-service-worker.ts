import 'reflect-metadata';
import {Injector, Injectable, provide} from 'angular2/src/core/di';

const MANIFEST: Object = {
  bundles: {
    app: {
      files: [
        // Core app
        [
          '/index.html',
          '/css/core.css',
          '/angular2-polyfills.js',
          '/system.js',
          '/vendor.js',
          '/app.js',
          '/app-shell.js',
          '/util/styleloader.js'
        ],
        // Images
        [
          '/images/apple-touch-icon.png',
          '/images/chrome-splashscreen-icon-384x384.png',
          '/images/chrome-touch-icon-192x192.png',
          '/images/ic_add_24px.svg',
          '/images/ic_info_outline_24px.svg',
          '/images/ic_menu_24px.svg',
          '/images/icon-128x128.png',
          '/images/side-nav-bg@2x.jpg'
        ],
        // External deps
        [
          'https://fonts.googleapis.com/css?family=Roboto:400,300,700,500,400italic'
        ]
      ],
      routes: {
        '/home': '/index.html'
      }
    }
  }
}

class SWLogger {
	log(...args: any[]) {
		console.log.apply(console, ['[service-worker]'].concat(args));
	}
}


const SW_EVENTS = {
	INSTALL: 'install',
	FETCH: 'fetch',
	ACTIVATE: 'activate'
}

abstract class SWContext {
	abstract addEventListener(event, handler);
}

class SWCacheStorage {
  open()
}


@Injectable()
class NgServiceWorker {
	constructor(serviceWorkerContext: SWContext, private _logger: SWLogger) {
		serviceWorkerContext.addEventListener(SW_EVENTS.ACTIVATE, (ev) => this.onActivate(ev));
		serviceWorkerContext.addEventListener(SW_EVENTS.INSTALL, (ev) => this.onInstall(ev));
		serviceWorkerContext.addEventListener(SW_EVENTS.FETCH, (ev) => this.onFetch(ev));
	}

	bootstrap() {
		this._logger.log('bootstrap')
	}

	onInstall(installEvent) {
    
	}

	private _onInstall() {
		return Promise.resolve('ready');
	}

	onActivate(activateEvent) {
		this._logger.log('activate', activateEvent);
	}
	onFetch(fetchEvent) {
		this._logger.log('fetch', fetchEvent.request.url);
	}
}

Injector
	.resolveAndCreate([
		SWLogger,
		provide(SWContext, { useValue: self }),
		NgServiceWorker, ])
	.get(NgServiceWorker)
	.bootstrap();