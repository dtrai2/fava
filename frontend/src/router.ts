/**
 * Routing
 *
 * Fava intercepts all clicks on links and will in most cases asynchronously
 * load the content of the page and replace the <article> contents with them.
 */

import type { SvelteComponent } from "svelte";
import type { Writable } from "svelte/store";
import { writable } from "svelte/store";

import { delegate, Events } from "./lib/events";
import { fetch, handleText } from "./lib/fetch";
import { DEFAULT_INTERVAL, getInterval } from "./lib/interval";
import { log_error } from "./log";
import { notify_err } from "./notifications";
import type { GetFrontendComponent } from "./reports/routes";
import { raw_page_title } from "./sidebar/page-title";
import { conversion, interval, urlHash } from "./stores";
import { showCharts } from "./stores/chart";
import { account_filter, fql_filter, time_filter } from "./stores/filters";
import { pathname, search } from "./stores/url";

/**
 * Set a store's inital value from the URL.
 */
export function setStoreValuesFromURL(): void {
  const params = new URL(window.location.href).searchParams;
  account_filter.set(params.get("account") ?? "");
  fql_filter.set(params.get("filter") ?? "");
  time_filter.set(params.get("time") ?? "");
  interval.set(getInterval(params.get("interval")));
  conversion.set(params.get("conversion") ?? "at_cost");
  showCharts.set(params.get("charts") !== "false");
}

/** Whether the logo should be spinning to indicate that something is loading. */
export const is_loading = writable(false);

/** Use this store to force reloads in components. */
export const should_reload = writable(1);

class Router extends Events<"page-loaded"> {
  /** The URL hash. */
  private hash: string;

  /** The URL pathname. */
  private pathname: string;

  /** The URL search string. */
  private search: string;

  /** The <article> element. */
  private article: HTMLElement;

  private shouldRenderInFrontend?: GetFrontendComponent;

  /** A possibly frontend rendered component. */
  private component?: SvelteComponent;

  /**
   * Function to intercept navigation, e.g., when there are unsaved changes.
   *
   * If they return a string, that is displayed to the user in an alert to
   * confirm navigation.
   */
  private interruptHandlers: Set<() => string | null>;

  constructor() {
    super();

    const article = document.querySelector("article");
    if (!article) {
      throw new Error("<article> element is missing from markup");
    }
    this.article = article;

    this.hash = window.location.hash;
    this.pathname = window.location.pathname;
    this.search = window.location.search;

    this.interruptHandlers = new Set();
  }

  /**
   * Add an interrupt handler. Returns a function that removes it.
   * This can be used directly in a svelte onMount hook.
   */
  addInteruptHandler(handler: () => string | null) {
    this.interruptHandlers.add(handler);

    return () => {
      this.interruptHandlers.delete(handler);
    };
  }

  /**
   * Check whether any of the registered interruptHandlers wants to stop
   * navigation.
   */
  private shouldInterrupt(): string | null {
    for (const handler of this.interruptHandlers) {
      const ret = handler();
      if (ret) {
        return ret;
      }
    }
    return null;
  }

  private frontendRender(url: URL | Location): void {
    const frontend = this.shouldRenderInFrontend?.(url);
    if (frontend) {
      const [Cls, title] = frontend;
      // Check if the component is changed - otherwise it should update itself.
      if (Cls !== this.component?.constructor) {
        this.component?.$destroy();
        this.article.innerHTML = "";
        this.component = new Cls({ target: this.article });
        raw_page_title.set(title);
      }
    } else {
      this.component?.$destroy();
      this.component = undefined;
    }
  }

  /**
   * This should be called once when the page has been loaded. Initializes the
   * router and takes over clicking on links.
   */
  init(shouldRenderInFrontend: GetFrontendComponent): void {
    this.shouldRenderInFrontend = shouldRenderInFrontend;
    urlHash.set(window.location.hash.slice(1));
    this.updateState();

    this.frontendRender(window.location);

    window.addEventListener("beforeunload", (event) => {
      const leaveMessage = this.shouldInterrupt();
      if (leaveMessage) {
        event.returnValue = leaveMessage;
      }
    });

    window.addEventListener("popstate", () => {
      urlHash.set(window.location.hash.slice(1));
      if (
        window.location.hash !== this.hash &&
        window.location.pathname === this.pathname &&
        window.location.search === this.search
      ) {
        this.updateState();
      } else if (
        window.location.pathname !== this.pathname ||
        window.location.search !== this.search
      ) {
        this.loadURL(window.location.href, false).catch(log_error);
        setStoreValuesFromURL();
      }
    });

    this.takeOverLinks();
  }

  /**
   * Go to URL. If load is `true`, load the page at URL, otherwise only update
   * the current state.
   */
  navigate(url: string, load = true): void {
    if (load) {
      this.loadURL(url).catch(log_error);
    } else {
      window.history.pushState(null, "", url);
      this.updateState();
    }
  }

  /*
   * Replace <article> contents with the page at `url`.
   *
   * If `historyState` is false, do not create a history state and do not
   * scroll to top.
   */
  private async loadURL(url: string, historyState = true): Promise<void> {
    const leaveMessage = this.shouldInterrupt();
    if (leaveMessage) {
      // eslint-disable-next-line no-alert
      if (!window.confirm(leaveMessage)) {
        return;
      }
    }

    const getUrl = new URL(url, window.location.href);

    this.frontendRender(getUrl);

    try {
      if (!this.component) {
        getUrl.searchParams.set("partial", "true");
        is_loading.set(true);
        const content = await fetch(getUrl.toString()).then(handleText);
        if (historyState) {
          window.history.pushState(null, "", url);
          window.scroll(0, 0);
        }
        this.updateState();
        this.article.innerHTML = content;
      } else {
        if (historyState) {
          window.history.pushState(null, "", url);
          window.scroll(0, 0);
        }
        this.updateState();
      }
      this.trigger("page-loaded");
      const hash = window.location.hash.slice(1);
      urlHash.set(hash);
      if (hash) {
        document.getElementById(hash)?.scrollIntoView();
      }
    } catch (error) {
      notify_err(error, (e) => `Loading ${url} failed: ${e.message}`);
    } finally {
      is_loading.set(false);
    }
  }

  /*
   * Update the routers state.
   *
   * The routers state is used to distinguish between the user navigating the
   * browser history or the hash changing.
   */
  private updateState(): void {
    this.hash = window.location.hash;
    this.pathname = window.location.pathname;
    this.search = window.location.search;
    pathname.set(this.pathname);
    search.set(this.search);
  }

  /*
   * Intercept all clicks on links (<a>) and .navigate() to the link instead.
   *
   * Doesn't intercept if
   *  - a button different from the main button is used,
   *  - a modifier key is pressed,
   *  - the link starts with a hash '#', or
   *  - the link has a `data-remote` attribute.
   */
  private takeOverLinks(): void {
    const is_normal_click = (event: MouseEvent) =>
      event.button === 0 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey;

    const is_external_link = (link: HTMLAnchorElement | SVGAElement) =>
      link.hasAttribute("data-remote") ||
      (link instanceof HTMLAnchorElement &&
        (link.host !== window.location.host ||
          !link.protocol.startsWith("http")));

    delegate(
      document,
      "click",
      "a",
      (event: MouseEvent, link: HTMLAnchorElement | SVGAElement) => {
        if (!is_normal_click(event)) {
          return;
        }
        if (event.defaultPrevented) {
          return;
        }
        if (link.getAttribute("href")?.charAt(0) === "#") {
          return;
        }
        if (is_external_link(link)) {
          return;
        }

        event.preventDefault();
        const href =
          link instanceof HTMLAnchorElement ? link.href : link.href.baseVal;

        this.navigate(href);
      }
    );
  }

  /*
   * Reload the page.
   */
  reload(): void {
    if (this.component) {
      should_reload.update((v) => v + 1);
    } else {
      this.loadURL(window.location.href, false).catch(log_error);
    }
  }
}

const router = new Router();
export default router;

/**
 * Sync a store value to the URL.
 *
 * Update and navigate to the URL on store changes.
 */
function syncToURL<T extends boolean | string>(
  store: Writable<T>,
  name: string,
  defaultValue: T,
  shouldLoad = true
): void {
  store.subscribe((val: T) => {
    const newURL = new URL(window.location.href);
    newURL.searchParams.set(name, val.toString());
    if (val === "" || val === defaultValue) {
      newURL.searchParams.delete(name);
    }
    if (newURL.href !== window.location.href) {
      router.navigate(newURL.href, shouldLoad);
    }
  });
}

/**
 * Update URL on store changes.
 */
export function syncStoreValuesToURL(): void {
  syncToURL(account_filter, "account", "");
  syncToURL(fql_filter, "filter", "");
  syncToURL(time_filter, "time", "");
  syncToURL(interval, "interval", DEFAULT_INTERVAL);
  syncToURL(conversion, "conversion", "at_cost");
  syncToURL(showCharts, "charts", true, false);
}
