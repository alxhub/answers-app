import 'reflect-metadata';
import {Injector, Injectable, provide} from 'angular2/src/core/di';

declare class Request {
  url: string;
  cache: string;
  referrer: string;
  mode: string;
  method: string;
  body: any;
  credentials: string;
  redirect: string;
  constructor(url: string, props?: Object); 
}

declare class Response {
  url: string;
  text(): Promise<string>;
  constructor(body: string);
}

class SWManifest {
  bundles: Object = {};
  
  toString(): string {
    var bundles = [];
    for (var bundle in this.bundles) {
      bundles.push(this.bundles[bundle].toString());
    }
    return bundles.join('\n');
  }
}

class SWManifestBundle {
  files: string[] = [];
  version: string = '0';
  routes: Object = {};
  constructor(public name: string) {}
  
  toString(): string {
    var routes: string = this._serializeRoutes();
    return `bundle ${this.name} {
  version: ${this.version},
  files:
    ${this.files.join('\n    ')}
  routes:
    ${routes}
}`;
  }
  
  get cache(): string {
    return `bundle.${this.name}.${this.version}`;
  }
  
  _serializeRoutes(): string {
    var routes = [];
    for (var route in this.routes) {
      routes.push(`${route}: ${this.routes[route]}`);
    }
    return routes.join('\n    ');
  }
}

class AppCacheManifestReader {
  swManifest: SWManifest = new SWManifest();
  bundle: SWManifestBundle = new SWManifestBundle('default');

  read(acManifest: string): void {
    acManifest
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== 'CACHE MANIFEST')
      .forEach((line) => {
        if (line.startsWith('#')) {
          this._parseComment(line);
        } else if (line.length > 0) {
          this.bundle.files.push(line);
        }
      });
    if (this.bundle.files.length > 0) {
      this.swManifest.bundles[this.bundle.name] = this.bundle;
    }
  }
  
  _parseComment(line: string) {
    var comment = line.substring(1).trim();
    if (!comment.startsWith('sw.')) {
      return;
    }
    comment = comment.substring(3);
    var colon = comment.indexOf(':');
    if (colon === -1) {
      return;
    }
    var key = comment.substring(0, colon).trim();
    var value = comment.substring(colon + 1).trim();
    switch (key) {
      case 'bundle':
        if (this.bundle.files.length > 0) {
          this.swManifest.bundles[this.bundle.name] = this.bundle;
        }
        this.bundle = new SWManifestBundle(value);
      case 'version':
        this.bundle.version = value;
      case 'route':
        this._parseRoute(value);
    }
  }
  
  _parseRoute(route: string) {
    var space = route.indexOf(' ');
    if (space === -1) {
      return;
    }
    var from = route.substring(0, space).trim();
    var serve = route.substring(space + 1).trim();
    this.bundle.routes[from] = serve;
  }
}

var MANIFEST = {};

const SW_EVENTS = {
	INSTALL: 'install',
	FETCH: 'fetch',
	ACTIVATE: 'activate'
}

abstract class SWContext {
  sw: NgServiceWorker;
	abstract addEventListener(event, handler);
  caches: any;
  weird: any;
  location: any;
  abstract fetch(req: Request): Promise<Response>;
}

@Injectable()
class NgServiceWorker {
  context: SWContext;

	constructor(serviceWorkerContext: SWContext) {
    this.context = serviceWorkerContext;
    this.context.sw = this;
    console.log('Service Worker startup!');

		serviceWorkerContext.addEventListener(SW_EVENTS.ACTIVATE, (ev) => this.onActivate(ev));
		serviceWorkerContext.addEventListener(SW_EVENTS.INSTALL, (ev) => this.onInstall(ev));
		serviceWorkerContext.addEventListener(SW_EVENTS.FETCH, (ev) => this.onFetch(ev));
	}
  
  loadManifestFromCache(cache: string): Promise<Response> {
    return this
      .context
      .caches
      .open(`manifest.${cache}`)
      .then((cache) => cache.match(new Request('/manifest.appcache')))
      .then((resp) => {
        // If no manifest is currently cached, return null.
        if (resp === undefined) {
          return null;
        }
        return resp;
      });
  }
  
  fetchManifest(): Promise<Response> {
    return this.fetchFresh(new Request('/manifest.appcache'))
      .then((resp) => {
        return resp;
      });
  }
  
  primeManifest(manifest: SWManifest): Promise<any> {
    var promises = [];
    for (var name in manifest.bundles) {
      var bundle = manifest.bundles[name];
      promises.push(this
        .context
        .caches
        .open(bundle.cache)
        .then((cache) => Promise.all(bundle
          .files
          .map((file) => {
            console.log(`bundle.${name}: caching ${file}`);
            return file;
          })
          .map((file) => new Request(file))
          .map((req) => this.fetchFresh(req).then((resp) => cache.put(req, resp)));
    }
    return Promise.all(promises)
  }
  
  setManifest(cache: string, resp: Response): Promise<any> {
    return this
      .context
      .caches
      .open(`manifest.${cache}`)
      .then((cache) => cache.put(new Request('/manifest.appcache'), resp));
  }
  
	onFetch(fetchEvent) {
    var request: Request = fetchEvent.request;
    fetchEvent.respondWith(this
      .readManifest()
      .then((manifest: SWManifest) => {
        // If no manifest exists, fall through to fetch().
        if (manifest === null || manifest === undefined) {
          console.log('Warning: no manifest so falling through to fetch()');
          return this.context.fetch(request);
        }
        
        var origin = this.context.location.origin;
        var requestUrl = request.url;
        if (requestUrl.startsWith(origin)) {
          requestUrl = requestUrl.substring(origin.length);
        }
        
        // First attempt to match against routes. If there's a matching route, use that instead.
        for (var name in manifest.bundles) {
          var bundle: SWManifestBundle = manifest.bundles[name];
          
          
          // If this bundle has a matching route, make a request for it instead.
          if (bundle.routes.hasOwnProperty(requestUrl)) {
            var targetUrl = bundle.routes[requestUrl];
            request = new Request(targetUrl);
            break;
          }
        }
        
        // Now attempt to match the request against the various bundle caches.
        var promises = [];
        for (var name in manifest.bundles) {
          var bundle: SWManifestBundle = manifest.bundles[name];
          promises.push(this
            .context
            .caches
            .open(bundle.cache)
            .then((cache) => cache.match(request))
            .then((resp) => resp !== undefined ? resp : null));
        }
        // Pick the first non-null response if there is one, and fall back on fetch if it's not found.
        return Promise
          .all(promises)
          .then((responses) => responses.reduce((prev, resp) => prev !== null ? prev : resp), null)
          .then((resp) => {
            if (resp !== null) {
              return resp;
            }
            return this.context.fetch(request);
          });
      })
    );
	}

	onInstall(installEvent) {
    console.log('installing...');
    // Fetch the current manifest.
    installEvent.waitUntil(this
      .fetchManifest()
      .then((resp) => {
        return resp
          .text()
          .then((text) => {
            var manifest = this._parseManifest(text);
            // Prime the caches before signaling to the forthcoming activation event that a background update has taken place.
            return this.primeManifest(manifest)
              .then(() => this.setManifest('latest', new Response(text)))
              .then(() => console.log('install complete'));
          });
      }));
  }

	onActivate(activateEvent) {
    console.log('activating...');
    // Promote the latest manifest to be active.
    activateEvent.waitUntil(Promise
      .all([this.loadManifestFromCache('latest'), this.loadManifestFromCache('active')])
      .then((manifests) => {
        var latest = manifests[0];
        var active = manifests[1];
        if (latest === null) {
          throw 'activation event but no manifest from installation?';
        }
        
        var latestText = latest !== null ? latest.text() : Promise.resolve('');
        var activeText = active !== null ? active.text() : Promise.resolve('');
        
        return Promise
          .all([latestText, activeText])
          .then((texts) => {
            if (texts[0] === texts[1]) {
              return;
            }
            console.log('application has been updated!');
            // Promote the latest manifest to be active.
            return this.setManifest('active', new Response(texts[0]));
          });
      }));
	}

  readManifest(): Promise<SWManifest> {
    return this
      .loadManifestFromCache('active')
      .then((resp) => {
        if (resp === null) {
          console.log("Null response from active cache - no manifest");
          return null;
        }
        return resp.text().then((text) => this._parseManifest(text));
      });
  }
  
  checkForUpdate(): Promise<boolean> {
    return Promise.all([
        this
          .fetchManifest()
          .then((resp) => resp.text()),
        this.loadManifestFromCache('active')
          .then((resp) => resp !== null ? resp.text() : Promise.resolve(''))
      ])
      .then((manifests) => {
        if (manifests[0] === manifests[1]) {
          console.log('No update available.');
          return false;
        }
        
        var manifest = this._parseManifest(manifests[0]);
        return this
          .primeManifest(manifest)
          .then(() => this.setManifest('active', new Response(manifests[0])))
          .then(() => console.log('Updated!'))
          .then(() => true);
      });
  }
  
  _parseManifest(manifest:string): SWManifest {
    if (manifest === undefined) {
      return null;
    }
    var reader = new AppCacheManifestReader();
    reader.read(manifest);
    return reader.swManifest;
  }
  
  fetchFresh(req: Request): Promise<Response> {
    return this.context.fetch(new Request(req.url, {
      method: req.method,
      body: req.body,
      mode: req.mode,
      credentials: req.credentials,
      redirect: req.redirect,
      referrer: req.referrer,
      cache: 'no-cache',
    }));
  }
}

Injector
	.resolveAndCreate([
		provide(SWContext, { useValue: self }),
		NgServiceWorker, ])
	.get(NgServiceWorker);