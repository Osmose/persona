// add helper routines onto wd that make common operations easy to do
// correctly

const wd        = require('wd/lib/webdriver'),
      utils     = require('./utils.js'),
      timeouts  = require('./timeouts.js');

function setTimeouts(opts) {
  opts.poll = opts.poll || timeouts.DEFAULT_POLL_MS;
  opts.timeout = opts.timeout || timeouts.DEFAULT_TIMEOUT_MS;
}

// wait for a element to become part of the dom and be visible to
// the user.  The element is identified by CSS selector.  options:
//   which: css selector specifying which element
//   poll (optional):
//   timeout (optional)
wd.prototype.waitForDisplayed = function(opts, cb) {
  if (typeof opts === 'string') opts = { which: opts };
  if (!opts.which) throw "css selector required";
  setTimeouts(opts);
  var browser = this;

  utils.waitFor(opts.poll, opts.timeout, function(done) {
    browser.elementByCss(opts.which, function(err, elem) {
      if (err) {
        var isComplete = false;
        if (typeof err === "object" && err.inspect) {
          // window is no longer available, we are done.
          if(/Window not found/.test(err.inspect())) {
            err = ("window gone - " + opts.which);
            isComplete = true;
          }
        } else if (typeof err === "string") {
          err = err + " - " + opts.which;
        }

        return done(isComplete, err, elem);
      }

      browser.displayed(elem, function(err, displayed) {
        done(!err && displayed, err, elem);
      });
    });
  }, cb);
};

// allocate a new browser session and sets implicit wait timeout
wd.prototype.newSession = function(opts, cb) {
  var browser = this;
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }

  browser.init(opts, function(err) {
    if (err) return cb(err);
    // let's set the http timeout at 2x the implicit wait timeout for
    // faster failures. (!300s)
    browser.setHTTPInactivityTimeout(2 * timeouts.DEFAULT_TIMEOUT_MS);
    // note!  the implicit wait timeout is different from other timeouts,
    // it's the amount of time certain wire transactions will wait for
    // procedures like find_element to succeed (we'll actually wait on the
    // *server* side for an element to become visible).  Having this be
    // the same as the global default timeout is interesting.
    browser.setImplicitWaitTimeout(timeouts.DEFAULT_TIMEOUT_MS, cb);
  });
};

// wait for a window, specified by name, to become visible and switch to it
//  .waitForWindow(<name>, <cb>)
//  or
//  .waitForWindow(<opts>, <cb>)
//
// If the latter invocation is employed, you can specify .poll and .timeout
// values.
wd.prototype.waitForWindow = function(opts, cb) {
  if (typeof opts === 'string') opts = { name: opts };
  if (!opts.name) throw "waitForWindow missing window `name`";
  var browser = this;

  setTimeouts(opts);
  utils.waitFor(opts.poll, opts.timeout, function(done) {
    browser.window(opts.name, function(err) {
      done(!err, err);
    });
  }, cb);
};

// close the currently open browser window and switch to one of the remaining
// open windows (deterministic if you know that exactly two windows are open)
wd.prototype.closeCurrentBrowserWindow = function(cb) {
  var self = this;
  self.close(function(err) {
    if (err) return cb(err);
    self.windowHandles(function(err, data) {
      if (err) return cb(err);
      if (data.length < 1) return cb("no window to switch to!");
      self.window(data[0], cb);
    });
  });
};

// wait for an element, specified by CSS selector, to have a non-empty text value.
//  .waitForWindow(<selector>, <cb>)
//  or
//  .waitForWindow(<opts>, <cb>)

wd.prototype.waitForElementText = function(opts, cb) {
  var self = this;
  if (typeof(opts) === 'string') opts = { which: opts };
  setTimeouts(opts);
  utils.waitFor(opts.poll, opts.timeout, function(done) {
    self.elementByCss(opts.which, function(err, elem) {
      if (err) return done(false, err, elem);
      self.text(elem, function(err, text) {
        done(!err && typeof text === 'string' && text.length, err, text);
      });
    });
  }, cb);
};


// convenience methods
wd.prototype.wfind = wd.prototype.waitForDisplayed;
wd.prototype.find = wd.prototype.elementByCss;

// convenience method to switch windows
//
// if no arguments are passed, switch to the base window--in a dialog flow,
// this will be the zeroth window in the list of handles.
//
// if arguments are passed in, they are forwarded to waitForWindow.
wd.prototype.wwin = function(opts, cb) {
  var self = this;

  // special case where just the callback was passed: go to the zeroth window
  if (arguments.length === 1 && typeof arguments[0] === 'function') {
    cb = arguments[0];
    self.windowHandles(function(err, handles) {
      if (err) return cb(err);
      self.window(handles[0], function(err) { cb(err); }); // fire cb whether err is defined or not
    });
  } else {
    self.waitForWindow(opts, cb);
  }
};
// wait for element to be displayed, then click on it.
// optionally accepts waitForDisplayed opts object instead of CSS selector
wd.prototype.wclick = function(opts, cb) {
  if (typeof opts === 'string') opts = { which: opts };
  if (!opts.which) throw "css selector required";

  var self = this;
  // To click on an element, two conditions must be met:
  // 1) The submit_disabled class must not be on the body
  // 2) The "disabled" attribute must not be on the element to click.
  // If both of these conditions are met, click the button, otherwise wait.
  //
  // The process used:
  // 1) wait for the element to be displayed.
  // 2) Once the element is displayed, the body is also displayed and
  //  can be queried for a reference.
  // 3) Check the body for the submit_disabled class name. If it exists, loop
  // again. If not, continue
  // 4) Check the element to click for the disabled attribute. If it exists,
  // loop again, if not - click the button.
  self.waitForDisplayed(opts, function(err, elToClick) {
    if (err) return cb(err);

    self.elementByTagName("body", function(err, bodyEl) {
      if (err) return cb(err);

      setTimeouts(opts);
      utils.waitFor(opts.poll, opts.timeout, function(done) {
        self.getAttribute(bodyEl, "class", function(err, classes) {
          // done has a different signature to most callbacks. done's first
          // parameter is whether the "waitFor" loop should complete. The
          // second is the error. The third is passed up the stack.
          if (err || /submit_disabled/.test(classes)) return done(!!err, err);

          self.getAttribute(elToClick, "disabled", function(err, value) {
            // IE returns a string value of "false" for false
            if (value === "false") value = false;
            if (err || value) return done(!!err, err);

            self.clickElement(elToClick, function(err) {
              done(!err, err, elToClick);
            });
          });
        });
      }, cb);
    });
  });
};

wd.prototype.click = function(which, cb) {
  var self = this;
  self.elementByCss(which, function(err, el) {
    if (err) return cb(err);
    self.clickElement(el, cb);
  });
};

// Click a button if it exists. If there is a timeout, no problem.
// Some buttons (like the Is this your computer) are only shown after
// a certain amount of time has elapsed. If the button is in the DOM,
// great, click it. If not, move on.
wd.prototype.wclickIfExists = function(opts, cb) {
  var self=this;
  // webdriver has a problem where if you search for an element that is
  // contained in a window that has closed itself, no response is returned. To
  // avoid this, set the implicit wait timeout to 0, try the click, if the
  // timeout hit or window gone exceptions are thrown, things are ok,
  // just move on.
  self.setImplicitWaitTimeout(0, function() {
    self.wclick(opts, function(err, el) {
      if (err) {
        // These two errors mean the element does not exist (or is not shown)
        // and we can move on without failing. Any other failures should cause
        // a stop in action.
        if(!(/timeout hit/.test(err) || /window gone/.test(err))) {
          return cb(err);
        }
      }

      // setImplictWaitTimeout fails if the 'window gone' error is
      // returned from wclick.
      if (!/window gone/.test(err)) {
        self.setImplicitWaitTimeout(timeouts.DEFAULT_TIMEOUT_MS, function(err) {
          cb(err, el);
        });
      }
      else {
        cb(null, el);
      }
    });
  });
};

wd.prototype.wgetAttribute = function(opts, attribute, cb) {
  var self = this;
  self.waitForDisplayed(opts, function(err, el) {
    if (err) return cb(err);
    self.getAttribute(el, attribute, cb);
  });
};


// wait for an element to be displayed, then type in it.
wd.prototype.wtype = function(opts, text, cb) {
  var self = this;
  self.waitForDisplayed(opts, function(err, el) {
    if (err) return cb(err);
    self.type(el, text, cb);
  });
};

// wait then return visible text for an element
wd.prototype.wtext = function(opts, cb) {
  var self = this;
  self.waitForDisplayed(opts, function(err, el) {
    if (err) return cb(err);
    self.text(el, cb);
  });
};

// delay before the next action
wd.prototype.delay = function(duration, cb) {
  setTimeout(cb, duration);
};

// wait then clear an input element
wd.prototype.wclear = function(opts, cb) {
  var self = this;
  self.waitForDisplayed(opts, function(err, el) {
    if (err) return cb(err);
    self.clear(el, cb);
  });
};
