/*! 물어물어(우편번호 자동검색기) v1.4 (출품본) · 주소록·양식 변환 화면 | (c) 2026 이희재 · 정읍우체국 | 2026 공공 AI 대전환 챌린지 출품본. 대회 규정에 따라 사용권 부여 */
(function () {
  "use strict";

  function qs(a, b) {
    return (b || document).querySelector(a);
  }
  function qsa(a, b) {
    return Array.prototype.slice.call((b || document).querySelectorAll(a));
  }
  function escHtml(a) {
    return String(a == null ? "" : a).replace(/[&<>"']/g, function (b) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
      }[b];
    });
  }
  function clean(a) {
    if (a == null) {
      return "";
    } else {
      return String(a).replace(/\s+/g, " ").trim();
    }
  }
  function colLetter(a) {
    var b = "";
    a++;
    while (a > 0) {
      var c = (a - 1) % 26;
      b = String.fromCharCode(65 + c) + b;
      a = Math.floor((a - 1) / 26);
    }
    return b;
  }
  function todayYmd() {
    var now = new Date();
    return now.getFullYear() + ("0" + (now.getMonth() + 1)).slice(-2) + ("0" + now.getDate()).slice(-2);
  }
  function ymdAfterDays(a) {
    var now = new Date(Date.now() + a * 86400000);
    return now.getFullYear() + ("0" + (now.getMonth() + 1)).slice(-2) + ("0" + now.getDate()).slice(-2);
  }
  function dateLabel(a) {
    if (/^\d{8}$/.test(a)) {
      return a.slice(0, 4) + "-" + a.slice(4, 6) + "-" + a.slice(6);
    } else {
      return a || "날짜 미상";
    }
  }
  function fmtNum(a) {
    return Number(a).toLocaleString("ko-KR");
  }
  function yieldFrame() {
    return new Promise(function (a) {
      setTimeout(a, 0);
    });
  }
  var settings = {
    get: function () {
      try {
        return JSON.parse(localStorage.getItem("zipfinder.v1") || "{}") || {};
      } catch (err) {
        return {};
      }
    },
    set: function (a) {
      try {
        var b = settings.get();
        for (var c in a) {
          b[c] = a[c];
        }
        localStorage.setItem("zipfinder.v1", JSON.stringify(b));
      } catch (err) {}
    }
  };
  var APP = function () {
    function a(b) {
      var c = document.querySelector("meta[name=\"" + b + "\"]");
      if (c) {
        return c.getAttribute("content") || "";
      } else {
        return "";
      }
    }
    return {
      name: "물어물어(우편번호 자동검색기)",
      version: a("version") || "1.0",
      author: "이희재",
      org: "",
      built: a("build-date") || ""
    };
  }();
  var APP_CREDIT = APP.name + " v" + APP.version + " · 제작 이희재";
  var privacyMask = {
    on: true,
    reveal: {},
    timer: {},
    SECONDS: 10
  };
  function maskWord(a) {
    if (a.length <= 1) {
      return "*";
    } else {
      return a.charAt(0) + new Array(a.length).join("*");
    }
  }
  var BUILDING_TAIL_RE = /(아파트|빌라|빌딩|타운|맨션|하이츠|캐슬|파크|타워|주공|연립|오피스텔|상가|@|#)$/;
  function maskAddr(a) {
    var b = str(a);
    if (!privacyMask.on || !b) {
      return b;
    }
    return b.replace(/\d+/g, function (c, d) {
      var f = d > 0 ? b.charAt(d - 1) : "";
      var g = b.charAt(d + c.length);
      if (g === "로" || g === "길" || g === "ㆍ" || g === "·") {
        return c;
      }
      if (f === "(" && g === ")" && c.length === 5) {
        return c;
      }
      if ((g === "동" || g === "리" || g === "가") && /[가-힣]/.test(f) && c.length <= 2 && !BUILDING_TAIL_RE.test(b.slice(0, d))) {
        return c;
      }
      return maskWord(c);
    });
  }
  function maskName(a) {
    var b = str(a);
    if (!privacyMask.on || !b) {
      return b;
    }
    if (/^[가-힣]{2}$/.test(b)) {
      return b.charAt(0) + "*";
    }
    if (/^[가-힣]{3,5}$/.test(b)) {
      return b.charAt(0) + new Array(b.length - 1).join("*") + b.charAt(b.length - 1);
    }
    if (b.length <= 2) {
      return b.charAt(0) + "*";
    } else {
      return b.slice(0, 2) + new Array(Math.min(7, b.length - 1)).join("*");
    }
  }
  function maskTel(a) {
    var b = str(a);
    if (!privacyMask.on || !b) {
      return b;
    }
    return b.replace(/(\d{2,4})([- ]?)(\d{3,4})([- ]?)(\d{4})/g, function (c, d, f, g, h, p) {
      return d + f + new Array(g.length + 1).join("*") + h + p;
    });
  }
  function str(a) {
    if (a == null) {
      return "";
    } else {
      return String(a);
    }
  }
  function maskByKind(a, b) {
    if (!privacyMask.on) {
      return str(a);
    }
    if (b === "name") {
      return maskName(a);
    }
    if (b === "tel" || b === "mobile") {
      return maskTel(a);
    }
    if (b === "addr" || b === "addr2") {
      return maskAddr(a);
    }
    return str(a);
  }
  function revealRow(a) {
    privacyMask.reveal[a] = true;
    addLog("가림 해제", 1, a + 1 + "행 " + privacyMask.SECONDS + "초");
    if (privacyMask.timer[a]) {
      clearTimeout(privacyMask.timer[a]);
    }
    privacyMask.timer[a] = setTimeout(function () {
      delete privacyMask.reveal[a];
      delete privacyMask.timer[a];
      refreshRow(a);
    }, privacyMask.SECONDS * 1000);
    refreshRow(a);
  }
  function maskedValue(a, b, c) {
    if (privacyMask.reveal[a.i]) {
      return str(b);
    } else {
      return maskByKind(b, c);
    }
  }
  function setBusy(a, b, c) {
    qs("#busy").hidden = !a;
    if (b) {
      qs("#busyText").textContent = b;
    }
    qs("#busyBar").style.width = Math.round((c || 0) * 100) + "%";
  }
  function setMsg(a, b, c) {
    a.hidden = !b;
    a.className = "msg" + (c ? " " + c : "");
    a.textContent = b || "";
  }
  var LOG_KEY = "zipfinder.log.v1";
  var LOG_MAX = 500;
  function loadLog() {
    try {
      var a = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
      if (Array.isArray(a)) {
        return a;
      } else {
        return [];
      }
    } catch (err) {
      return [];
    }
  }
  function addLog(a, b, c) {
    try {
      var d = loadLog();
      var now = new Date();
      function f(g) {
        return ("0" + g).slice(-2);
      }
      d.push({
        t: now.getFullYear() + "-" + f(now.getMonth() + 1) + "-" + f(now.getDate()) + " " + f(now.getHours()) + ":" + f(now.getMinutes()) + ":" + f(now.getSeconds()),
        a: a,
        n: b || 0,
        m: c || ""
      });
      if (d.length > LOG_MAX) {
        d = d.slice(-LOG_MAX);
      }
      localStorage.setItem(LOG_KEY, JSON.stringify(d));
    } catch (err) {}
  }
  function clearLog() {
    try {
      localStorage.removeItem(LOG_KEY);
    } catch (err) {}
    addLog("이력 지움", 0, "");
  }
  var EMPTY_COLS = {
    addr: [],
    addr2: -1,
    zip: -1,
    name: -1,
    tel: -1,
    mobile: -1,
    item: -1,
    memo: -1,
    qty: -1,
    sName: -1,
    sZip: -1,
    sAddr: -1,
    sAddr2: -1,
    sTel: -1,
    sMobile: -1
  };
  var appState = {
    engine: null,
    dbSource: "",
    embeddedDate: "",
    extra: null,
    headerAuto: "",
    fileName: "",
    wb: null,
    sheet: "",
    aoa: [],
    headerIdx: -1,
    ncol: 0,
    cols: EMPTY_COLS,
    rows: [],
    filter: "all",
    shown: 0,
    elapsed: 0,
    preset: "orig",
    searchFor: null
  };
  var S = appState;
  var TABLE_PAGE = 300;
  var EPOST_DB_URL = "https://www.epost.go.kr/search/zipcode/areacdAddressDown.jsp";
  var LAW_NOTICE_URL = "https://www.law.go.kr/LSW/admRulSc.do?menuId=5&subMenuId=41&tabMenuId=183&query=" + encodeURIComponent("도로명주소 연계 우편번호 조정 고시");
  var DEFAULT_WARN_DAYS = 90;
  function b64ToBytes(a) {
    var b = atob(a);
    var c = b.length;
    var d = new Uint8Array(c);
    for (var i = 0; i < c; i++) {
      d[i] = b.charCodeAt(i);
    }
    return d;
  }
  function gunzipText(a) {
    if (typeof DecompressionStream === "function") {
      try {
        return new Response(new Blob([a]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
      } catch (err) {}
    }
    return Promise.resolve(fflate.strFromU8(fflate.gunzipSync(a)));
  }
  var idb = {
    open: function () {
      return new Promise(function (a, b) {
        if (!window.indexedDB) {
          return b(new Error("no idb"));
        }
        var c = indexedDB.open("zipfinder", 1);
        c.onupgradeneeded = function () {
          c.result.createObjectStore("kv");
        };
        c.onsuccess = function () {
          a(c.result);
        };
        c.onerror = function () {
          b(c.error);
        };
      });
    },
    get: function (a) {
      return idb.open().then(function (b) {
        return new Promise(function (c, d) {
          var f = b.transaction("kv").objectStore("kv").get(a);
          f.onsuccess = function () {
            c(f.result);
          };
          f.onerror = function () {
            d(f.error);
          };
        });
      });
    },
    set: function (a, b) {
      return idb.open().then(function (c) {
        return new Promise(function (d, f) {
          var g = c.transaction("kv", "readwrite");
          g.objectStore("kv").put(b, a);
          g.oncomplete = function () {
            d();
          };
          g.onerror = function () {
            f(g.error);
          };
        });
      });
    },
    del: function (a) {
      return idb.open().then(function (b) {
        return new Promise(function (c) {
          var d = b.transaction("kv", "readwrite");
          d.objectStore("kv").delete(a);
          d.oncomplete = function () {
            c();
          };
          d.onerror = function () {
            c();
          };
        });
      });
    }
  };
  function dbAgeDays() {
    var a = S.engine && S.engine.date;
    if (!/^\d{8}$/.test(a || "")) {
      return null;
    }
    var now = new Date(+a.slice(0, 4), +a.slice(4, 6) - 1, +a.slice(6));
    return Math.floor((Date.now() - now.getTime()) / 86400000);
  }
  function warnDays() {
    var a = Number(settings.get().warnDays);
    if (a >= 30) {
      return a;
    } else {
      return DEFAULT_WARN_DAYS;
    }
  }
  function showDbInfo(a, b) {
    S.engine = new ZipEngine(a, S.extra);
    S.dbSource = b;
    var c = a.stats || {};
    var d = dbAgeDays();
    var f = warnDays();
    var g = d == null ? "" : d >= f ? "old" : d >= 35 ? "warn" : "";
    qs("#dbDot").className = "dot " + (g === "old" ? "err" : g === "warn" ? "warn" : "on");
    qs("#dbInfo").innerHTML = "우편번호 DB 기준일 <b>" + escHtml(dateLabel(a.date)) + "</b> · " + escHtml(b) + " <span title=\"도로명 구간 " + fmtNum(c.road || 0) + " · 지번 구간 " + fmtNum(c.jibun || 0) + " · 사서함 " + fmtNum(c.pobox || 0) + "\">(구간 " + fmtNum((c.road || 0) + (c.jibun || 0)) + "건)</span>" + (d == null ? "" : " <span class=\"age " + g + "\">" + (d <= 0 ? "오늘 기준" : d + "일 지남") + "</span>") + (b !== "내장" ? " <button type=\"button\" class=\"btn ghost sm\" id=\"btnDbReset\">내장 DB로</button>" : "");
    var btnDbResetEl = qs("#btnDbReset");
    if (btnDbResetEl) {
      btnDbResetEl.onclick = function () {
        idb.del("db").then(function () {
          location.reload();
        });
      };
    }
    paintRegionMsg();
  }
  function loadDb() {
    var zipextraEl = qs("#zipextra");
    var a = zipextraEl && zipextraEl.textContent.trim() ? gunzipText(b64ToBytes(zipextraEl.textContent.trim())).then(function (b) {
      S.extra = JSON.parse(b);
    }).catch(function () {
      S.extra = null;
    }) : Promise.resolve();
    return a.then(function () {
      var b = qs("#zipdb").textContent.trim();
      return gunzipText(b64ToBytes(b)).then(function (c) {
        var d = JSON.parse(c);
        S.embeddedDate = d.date || "";
        return idb.get("db").then(function (f) {
          if (f && f.gz && f.date && f.date >= S.embeddedDate) {
            return gunzipText(f.gz).then(function (g) {
              showDbInfo(JSON.parse(g), "교체본");
            });
          }
          showDbInfo(d, "내장");
        }).catch(function () {
          showDbInfo(d, "내장");
        });
      });
    });
  }
  function importDbFiles(a) {
    var b = Array.prototype.map.call(a, function (d) {
      return d.name || "";
    }).join(" ");
    var c = /별표|붙임|고시/.test(b) ? "고시 별표 5" : /areacd|rangeaddr/i.test(b) ? "인터넷우체국" : "";
    return buildDbFromFiles(Array.prototype.map.call(a, function (d) {
      return {
        name: d.name,
        get: function () {
          return d.arrayBuffer();
        }
      };
    }), c);
  }
  function buildDbFromFiles(a, b) {
    setBusy(true, "DB 파일을 읽는 중…", 0.1);
    var c = {
      road: "",
      jibun: "",
      pobox: "",
      date: ""
    };
    var d = {};
    function f(h, p) {
      if (!/\.txt$/i.test(h)) {
        return;
      }
      var q = new TextDecoder("utf-8").decode(p.subarray(0, 600)).split("\n")[0];
      var r = (h.match(/(20\d{6})/) || [])[1];
      if (q.indexOf("범위종류") >= 0) {
        c.road = new TextDecoder("utf-8").decode(p);
        if (r) {
          c.date = r;
        }
        d.road = 1;
      } else if (q.indexOf("시작주번지") >= 0) {
        c.jibun = new TextDecoder("utf-8").decode(p);
        if (r && !c.date) {
          c.date = r;
        }
        d.jibun = 1;
      } else if (q.indexOf("사서함명") >= 0) {
        c.pobox = new TextDecoder("utf-8").decode(p);
        d.pobox = 1;
      } else if (q.indexOf("이동사유코드") >= 0) {
        d.chg = 1;
      } else if (q.indexOf("건물관리번호") >= 0) {
        d.area = 1;
      }
    }
    var g = a.map(function (h) {
      return h.get().then(function (p) {
        var q = new Uint8Array(p);
        if (q[0] === 80 && q[1] === 75) {
          var r = fflate.unzipSync(q, {
            filter: function (s) {
              if (!/\.txt$/i.test(s.name)) {
                return false;
              }
              if (s.originalSize > 60000000) {
                d.big = 1;
                return false;
              }
              return true;
            }
          });
          Object.keys(r).forEach(function (s) {
            f(s, r[s]);
          });
        } else if (/\.(hwpx?|pdf|doc|docx)$/i.test(h.name || "")) {
          d.doc = 1;
        } else {
          f(h.name, q);
        }
      });
    });
    return Promise.all(g).then(yieldFrame).then(function () {
      if (!c.road || !c.jibun) {
        if (d.area || d.big) {
          throw new Error("넣으신 것은 「지역별 주소 DB」(고시 별표 1~4)입니다. 이 프로그램은 구간 자료를 쓰므로 같은 고시의 <별표 5 참고자료(도로명주소 및 지번주소 범위자료, 사서함)>를 넣어 주세요.");
        }
        if (d.chg) {
          throw new Error("넣으신 것은 「변경분 DB」(변동분)입니다. 이 프로그램은 전체 구간 자료를 쓰므로 고시의 <별표 5>를 넣어 주세요.");
        }
        if (d.doc) {
          throw new Error("고시 본문 문서입니다. 그 공문에 함께 붙어 오는 <별표 5> 압축파일을 넣어 주세요.");
        }
        if (d.road || d.jibun) {
          throw new Error("도로명범위·지번범위 두 가지가 모두 있어야 합니다(" + (d.road ? "지번범위" : "도로명범위") + " 파일이 없습니다). 별표 5 압축파일을 풀지 말고 그대로 넣어 주세요.");
        }
        throw new Error("우편번호 범위자료를 찾지 못했습니다. 고시 문서의 <별표 5> 또는 인터넷우체국의 areacd_rangeaddr_DB.zip을 그대로 넣어 주세요.");
      }
      setBusy(true, "색인을 만드는 중…", 0.5);
      return yieldFrame().then(function () {
        if (!c.date) {
          c.date = todayYmd();
        }
        var h = ZipDbBuild.build(c);
        if (!c.pobox && S.engine) {
          var p = S.engine.db;
          var q = {};
          h.sgg.forEach(function (v, idx) {
            q[h.sido[v[0]] + "|" + v[1]] = idx;
          });
          p.pobox.forEach(function (v) {
            var w = p.sido[p.sgg[v[0]][0]] + "|" + p.sgg[v[0]][1];
            if (q[w] !== undefined) {
              var x = v.slice();
              x[0] = q[w];
              h.pobox.push(x);
            }
          });
          h.stats.pobox = h.pobox.length;
        }
        var r = [];
        var s = 0;
        try {
          s = new ZipEngine(h).zipSet().size;
        } catch (err) {
          s = 0;
        }
        if (h.stats.road < 200000) {
          r.push("도로명 구간이 " + fmtNum(h.stats.road) + "건뿐입니다(정상 30만 건 이상)");
        }
        if (h.stats.jibun < 150000) {
          r.push("지번 구간이 " + fmtNum(h.stats.jibun) + "건뿐입니다(정상 25만 건 이상)");
        }
        if (h.sgg.length < 200) {
          r.push("시·군·구가 " + h.sgg.length + "곳뿐입니다(정상 250곳 이상)");
        }
        if (s < 25000) {
          r.push("우편번호 종류가 " + fmtNum(s) + "개뿐입니다(정상 3만 개 이상)");
        }
        if (/^\d{8}$/.test(h.date) && h.date > ymdAfterDays(7)) {
          r.push("기준일(" + dateLabel(h.date) + ")이 앞날로 되어 있습니다");
        }
        if (r.length) {
          throw new Error("이 파일은 정상적인 우편번호 DB로 보이지 않아 적용하지 않았습니다. " + r.join(" · ") + ". 인터넷우체국이나 고시 공문에서 받은 원본인지 확인해 주세요.");
        }
        if (S.engine && /^\d{8}$/.test(S.engine.date) && /^\d{8}$/.test(h.date) && h.date < S.engine.date) {
          setBusy(false);
          if (!window.confirm("넣으신 DB의 기준일(" + dateLabel(h.date) + ")이 지금 쓰는 DB(" + dateLabel(S.engine.date) + ")보다 이전입니다.\n\n그래도 바꿀까요?")) {
            throw new Error("이전 기준일의 DB라 바꾸지 않았습니다.");
          }
          setBusy(true, "저장하는 중…", 0.85);
        }
        setBusy(true, "저장하는 중…", 0.85);
        var t = fflate.gzipSync(fflate.strToU8(JSON.stringify(h)), {
          level: 6
        });
        var u = {
          gz: t,
          date: h.date
        };
        return idb.set("db", u).catch(function () {
          return "nosave";
        }).then(function (v) {
          var w = b ? "교체본(" + b + ")" : "교체본";
          showDbInfo(h, v === "nosave" ? w + "(이번만 적용)" : w);
          setBusy(false);
          settings.set({
            lastCheck: todayYmd()
          });
          addLog("DB 교체", h.stats.road + h.stats.jibun, dateLabel(h.date) + " 기준" + (b ? " · " + b : ""));
          var updDlgEl = qs("#updDlg");
          if (updDlgEl && updDlgEl.open) {
            if (updDlgEl.close) {
              updDlgEl.close();
            } else {
              updDlgEl.removeAttribute("open");
            }
          }
          showFileMsg("우편번호 DB를 " + dateLabel(h.date) + " 기준으로 바꿨습니다." + (d.pobox ? " (도로명범위·지번범위·사서함 모두 반영)" : " 사서함 자료는 이전 것을 그대로 씁니다.") + (v === "nosave" ? " 다만 이 브라우저에서는 저장이 막혀 있어 창을 닫으면 내장 DB로 돌아갑니다." : ""), "ok");
        });
      });
    }).catch(function (h) {
      setBusy(false);
      showFileMsg(h.message || String(h), "err");
      throw h;
    });
  }
  function showFileMsg(a, b) {
    setMsg(qs("#fileMsg"), a, b);
    qs("#step1").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
  function decodeText(a) {
    if (a.length >= 3 && a[0] === 239 && a[1] === 187 && a[2] === 191) {
      return new TextDecoder("utf-8").decode(a.subarray(3));
    }
    if (a.length >= 2 && (a[0] === 255 && a[1] === 254 || a[0] === 254 && a[1] === 255)) {
      return new TextDecoder(a[0] === 255 ? "utf-16le" : "utf-16be").decode(a.subarray(2));
    }
    try {
      return new TextDecoder("utf-8", {
        fatal: true
      }).decode(a);
    } catch (err) {
      return new TextDecoder("euc-kr").decode(a);
    }
  }
  function protectPrototype() {
    var a = Object.getOwnPropertyNames(Object.prototype);
    return function () {
      Object.getOwnPropertyNames(Object.prototype).forEach(function (b) {
        if (a.indexOf(b) < 0) {
          try {
            delete Object.prototype[b];
          } catch (err) {}
        }
      });
    };
  }
  function readFileSafely(a) {
    var b = protectPrototype();
    return readWorkbook(a).then(function (c) {
      b();
      return c;
    }, function (c) {
      b();
      throw c;
    });
  }
  function readWorkbook(a) {
    return a.arrayBuffer().then(function (b) {
      var c = new Uint8Array(b);
      var d = c[0] === 80 && c[1] === 75;
      var f = c[0] === 208 && c[1] === 207;
      if (!d && !f) {
        var g = decodeText(c);
        if (/^\s*<(?:!DOCTYPE|html|table|\?xml)/i.test(g)) {
          return XLSX.read(g, {
            type: "string"
          });
        }
        return XLSX.read(g, {
          type: "string",
          raw: true
        });
      }
      return XLSX.read(c, {
        type: "array",
        cellDates: false,
        cellNF: true
      });
    });
  }
  function cellText(a) {
    if (!a || a.t === "z" || a.t === "e") {
      return "";
    }
    if (a.t === "n") {
      if (typeof a.v === "number" && Math.floor(a.v) === a.v && a.w && /^-?\d{1,3}(?:,\d{3})+$/.test(a.w)) {
        return String(a.v);
      }
      if (typeof a.v === "number" && Math.floor(a.v) === a.v && Math.abs(a.v) >= 10000000000 && Math.abs(a.v) < 10000000000000000 && (!a.w || !/[\/:\-년월]/.test(a.w))) {
        return String(a.v);
      }
      if (a.w != null) {
        return String(a.w);
      } else {
        return String(a.v);
      }
    }
    if (a.t === "b") {
      if (a.v) {
        return "TRUE";
      } else {
        return "FALSE";
      }
    }
    if (a.w != null && a.t !== "s") {
      return String(a.w);
    } else {
      return String(a.v == null ? "" : a.v);
    }
  }
  function sheetToRows(a) {
    if (!a || !a["!ref"]) {
      return [];
    }
    var b = XLSX.utils.decode_range(a["!ref"]);
    var c = [];
    var d = Math.min(b.e.r, 1048575);
    var f = Math.min(b.e.c, 255);
    if (d > 50000) {
      var mx = -1;
      Object.keys(a).forEach(function (k) {
        if (k.charAt(0) !== "!") {
          var rc = XLSX.utils.decode_cell(k);
          if (rc.r > mx) {
            mx = rc.r;
          }
        }
      });
      d = Math.max(0, Math.min(d, mx));
    }
    for (var i = 0; i <= d; i++) {
      var g = [];
      for (var j = 0; j <= f; j++) {
        var h = {
          r: i,
          c: j
        };
        var p = a[XLSX.utils.encode_cell(h)];
        g.push(p ? cellText(p) : "");
      }
      while (g.length && g[g.length - 1] === "") {
        g.pop();
      }
      c.push(g);
    }
    while (c.length && c[c.length - 1].every(function (q) {
      return clean(q) === "";
    })) {
      c.pop();
    }
    return c;
  }
  function readInputFile(a) {
    if (!S.engine) {
      setMsg(qs("#fileMsg"), "우편번호 DB를 아직 여는 중입니다. 잠시 뒤 다시 넣어 주세요.", "warn");
      return;
    }
    if (/\.(hwpx?|pdf|docx?|pptx?)$/i.test(a.name || "")) {
      return setMsg(qs("#fileMsg"), /고시|별표/.test(a.name) ? "우편번호 고시 본문 문서입니다. 주소록이 아니라면, 그 공문 붙임의 「별표 5」 압축파일을 「DB 최신화」에 넣어 주세요." : "이 형식(" + a.name.replace(/^.*\./, "") + ")은 주소록으로 읽지 못합니다. 엑셀·한셀·CSV로 저장해 넣어 주세요.", "warn");
    }
    setMsg(qs("#fileMsg"), "");
    setBusy(true, "파일을 읽는 중…", 0.2);
    yieldFrame().then(function () {
      return readFileSafely(a);
    }).then(function (b) {
      S.wb = b;
      S.fileName = a.name;
      var c = b.SheetNames[0];
      var d = -1;
      b.SheetNames.forEach(function (f) {
        var g = b.Sheets[f];
        var h = g && g["!ref"] ? XLSX.utils.decode_range(g["!ref"]).e.r : -1;
        if (h > d) {
          d = h;
          c = f;
        }
      });
      loadWorkbook(c);
      addLog("파일 열기", Math.max(0, S.aoa.length - (S.headerIdx + 1)), a.name);
      setBusy(false);
    }).catch(function (b) {
      setBusy(false);
      var c = /password|encrypt/i.test(String(b && b.message)) ? "암호가 걸린 파일입니다. 암호를 풀고 다시 넣어 주세요." : "이 파일은 읽지 못했습니다. 문서보안(DRM)이 걸려 있거나 한셀 옛 형식일 수 있습니다. 엑셀·한셀에서 「다른 이름으로 저장 ▸ xlsx」로 저장한 뒤 다시 넣어 주세요.";
      setMsg(qs("#fileMsg"), c, "err");
    });
  }
  function loadPastedText(a) {
    var b = a.replace(/\r\n?/g, "\n").split("\n").filter(function (d) {
      return d.trim();
    });
    if (b.length && b.some(function (d) {
      return d.indexOf("\t") >= 0;
    })) {
      S.wb = null;
      S.sheet = "붙여넣기";
      S.fileName = "붙여넣기.xlsx";
      S.aoa = b.map(function (d) {
        return d.split("\t").map(clean);
      });
      setMsg(qs("#fileMsg"), "");
      addLog("붙여넣기", S.aoa.length, "표 " + S.aoa[0].length + "칸");
      return openSheet("붙여넣기");
    }
    var c = a.split(/\r?\n/).map(clean).filter(Boolean);
    if (!c.length) {
      return setMsg(qs("#fileMsg"), "주소를 한 줄 이상 넣어 주세요.", "warn");
    }
    if (c.length > 1 && c[0].length <= 20 && HEADER_WORD_RE.test(c[0]) && !looksLikeAddress(c[0]) && S.engine.lookup(c[0]).grade === "실패") {
      c.shift();
    }
    setMsg(qs("#fileMsg"), "");
    S.wb = null;
    S.sheet = "주소";
    S.fileName = "직접입력.xlsx";
    S.aoa = [["주소"]].concat(c.map(function (d) {
      return [d];
    }));
    openSheet("직접 입력");
  }
  function loadWorkbook(a) {
    S.sheet = a;
    S.aoa = sheetToRows(S.wb.Sheets[a]);
    openSheet(a);
  }
  var HEADER_WORD_RE = /주소|소재지|배송지|도착지|성명|성함|이름|수취인|받는|수령|고객|거래처|기관|부서|직위|회사|업체|상호|우편|전화|연락처|휴대|핸드폰|상품|품명|내용품|물품|비고|메모|메시지|메세지|순번|연번|일련|번호|구분|일자|날짜|금액|단가|수량|통수|박스|발송|보내는|송하인|주문|배송|지역|시도|시군구|읍면동|상세|동호수|이메일|e-?mail|address|addr|name|tel|zip|post/i;
  function looksLikeAddress(a) {
    return a.length >= 5 && /[가-힣]/.test(a) && /(로|길)\s*\d|[동리가]\s*(산\s*)?\d|\d\s*번지|아파트|\d+\s*동\s*\d+\s*호|[시군구]\s+\S+[읍면동로길]/.test(a);
  }
  function headerKey(a) {
    return clean(a).replace(/\s+/g, "");
  }
  function headerLabel(v) {
    var t = v == null ? "" : String(v);
    var L = t.split(/\r?\n/);
    for (var k = 0; k < L.length; k++) {
      var x = clean(L[k]);
      if (x) {
        return x;
      }
    }
    return "";
  }
  function findHeaderRow(a) {
    var b = Math.min(a.length, 25);
    var c = -1;
    var d = 0;
    var f = 0;
    a.forEach(function (r) {
      if (r.length > f) {
        f = r.length;
      }
    });
    for (var i = 0; i < b; i++) {
      var g = a[i].map(headerLabel).filter(Boolean);
      if (!g.length || g.some(function (r) {
        return r.length > 40;
      })) {
        continue;
      }
      if (g.some(looksLikeAddress)) {
        continue;
      }
      var h = g.filter(function (r) {
        return HEADER_WORD_RE.test(headerKey(r));
      }).length;
      if (!h) {
        continue;
      }
      var p = g.filter(function (r) {
        return /\d{2,}/.test(r) && !/주소\s*\d/.test(r);
      }).length;
      var q = h * 2 + Math.min(g.length, 8) - p * 3 + (g.length >= 3 ? 2 : 0) + (g.length === 1 && f > 1 ? -4 : 0);
      if (i >= a.length - 1) {
        q -= 5;
      }
      if (q > d) {
        d = q;
        c = i;
      }
    }
    if (d >= 3) {
      return c;
    } else {
      return -1;
    }
  }
  function checkFirstRowHeader() {
    if (S.headerIdx >= 0 || !S.cols.addr.length) {
      return false;
    }
    var a = -1;
    var b;
    for (b = 0; b < Math.min(S.aoa.length, 5); b++) {
      if (S.aoa[b].some(function (q) {
        return clean(q);
      })) {
        a = b;
        break;
      }
    }
    if (a < 0 || S.aoa.length - a < 2) {
      return false;
    }
    var c = regionOpts();
    function d(q) {
      return S.cols.addr.map(function (r) {
        return clean(S.aoa[q][r]);
      }).filter(Boolean).join(" ");
    }
    var f = d(a);
    if (!f || f.length > 40 || looksLikeAddress(f)) {
      return false;
    }
    if (S.engine.lookup(f, c).grade !== "실패") {
      return false;
    }
    var g = 0;
    var h = 0;
    for (b = a + 1; b < S.aoa.length && g < 8; b++) {
      var p = d(b);
      if (!p) {
        continue;
      }
      g++;
      if (looksLikeAddress(p) || S.engine.lookup(p, c).grade !== "실패") {
        h++;
      }
    }
    if (!g || h < Math.max(1, Math.ceil(g * 0.6))) {
      return false;
    }
    S.headerIdx = a;
    S.headerAuto = "첫 줄(" + (f.length > 14 ? f.slice(0, 14) + "…" : f) + ")은 항목 이름으로 보고 제목 줄로 잡았습니다.";
    return true;
  }
  function detectColumns() {
    var a = S.aoa;
    var b = S.headerIdx;
    var c = a.slice(b + 1);
    var d = 0;
    a.forEach(function (b2) {
      if (b2.length > d) {
        d = b2.length;
      }
    });
    S.ncol = d;
    var f = b >= 0 ? a[b].map(headerLabel) : [];
    var g = c.filter(function (b2) {
      return b2.some(function (c2) {
        return clean(c2);
      });
    }).slice(0, 200);
    var h = regionOpts();
    function p(b2) {
      return g.map(function (c2) {
        return clean(c2[b2]);
      }).filter(Boolean);
    }
    function q(b2) {
      if (!b2.length) {
        return 0;
      }
      var c2 = b2.slice(0, 40);
      var d2 = 0;
      var f2 = 0;
      c2.forEach(function (g2) {
        var h2 = S.engine.lookup(g2, h);
        d2 += h2.grade === "정확" ? 1 : h2.grade === "유사" ? h2.conf === "상" ? 0.8 : h2.conf === "중" ? 0.6 : 0.4 : 0;
        if (looksLikeAddress(g2)) {
          f2++;
        }
      });
      return Math.max(d2 / c2.length, f2 * 0.5 / c2.length) * Math.min(1, b2.length / Math.max(1, g.length) + 0.5);
    }
    var r = [];
    var s = [];
    for (var i = 0; i < d; i++) {
      var t = p(i);
      r.push(q(t));
      var u = t.filter(function (b2) {
        return /^\d{5}$|^\d{3}-?\d{3}$|^\d{4}$/.test(b2);
      }).length;
      s.push(t.length ? u / t.length : 0);
    }
    function v(b2, c2) {
      for (var m = 0; m < f.length; m++) {
        var d2 = headerKey(f[m]);
        if (b2.test(d2) && (!c2 || !c2.test(d2))) {
          return m;
        }
      }
      return -1;
    }
    var w = {
      addr: [],
      addr2: -1,
      zip: -1,
      name: -1,
      tel: -1,
      mobile: -1,
      item: -1,
      memo: -1,
      qty: -1,
      sName: -1,
      sZip: -1,
      sAddr: -1,
      sAddr2: -1,
      sTel: -1,
      sMobile: -1
    };
    var x = w;
    var y = /발송|보내는|송하인|주문자|신청인/;
    var z = -1;
    var a1 = 0;
    for (i = 0; i < d; i++) {
      var b1 = f[i] || "";
      if (/상세|나머지|이메일|e-?mail|IP/i.test(b1) || y.test(b1)) {
        continue;
      }
      var c1 = /주소|소재지|배송지|address|addr/i.test(b1) ? 0.35 : 0;
      if (r[i] + c1 > a1 && (r[i] >= 0.3 || c1)) {
        a1 = r[i] + c1;
        z = i;
      }
    }
    if (z >= 0) {
      x.addr = [z];
    }
    if (z < 0 || r[z] < 0.5) {
      var d1 = null;
      for (var j = 0; j < d; j++) {
        for (var k = 2; k <= 4 && j + k <= d; k++) {
          var f1 = g.map(function (b2) {
            var c2 = [];
            for (var m = j; m < j + k; m++) {
              c2.push(clean(b2[m]));
            }
            return c2.filter(Boolean).join(" ");
          }).filter(Boolean);
          var g1 = q(f1);
          if (g1 >= 0.5 && (!d1 || g1 > d1.sc + 0.02 || g1 >= d1.sc - 0.02 && j === d1.a && k > d1.len)) {
            d1 = {
              a: j,
              len: k,
              sc: g1
            };
          }
        }
      }
      if (d1 && (z < 0 || d1.sc > r[z] + 0.15)) {
        x.addr = [];
        for (var n = d1.a; n < d1.a + d1.len; n++) {
          x.addr.push(n);
        }
      }
    }
    var h1 = v(/상세|나머지|주소\s*2|addr\w*\s*2/i, y);
    if (h1 >= 0 && x.addr.indexOf(h1) < 0) {
      x.addr2 = h1;
    }
    function p1(re, ex) {
      for (var k = 0; k < f.length; k++) {
        var h = headerKey(f[k]);
        if (h && y.test(h) && re.test(h) && !(ex && ex.test(h))) {
          return k;
        }
      }
      return -1;
    }
    function q1(re, ex, anchor, skip) {
      var best = -1;
      var bd = 1e9;
      for (var k = 0; k < f.length; k++) {
        if (skip && skip.indexOf(k) >= 0) {
          continue;
        }
        var h = headerKey(f[k]);
        if (!h || !re.test(h) || ex && ex.test(h)) {
          continue;
        }
        var d = anchor >= 0 ? Math.abs(k - anchor) + (k > anchor ? 0.5 : 0) : k;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      return best;
    }
    var r1 = /우편\s*번호|우편|zip|post/i;
    var s1 = /수취|받는|받을|수령|수신/;
    x.sAddr = p1(/주소|소재지|address|addr/i, /상세|나머지|주소\s*2|addr\w*\s*2|이메일|e-?mail/i);
    if (x.sAddr >= 0 && x.addr.indexOf(x.sAddr) >= 0) {
      x.sAddr = -1;
    }
    x.sAddr2 = p1(/상세|나머지|주소\s*2|addr\w*\s*2/i, /이메일|e-?mail/i);
    x.sName = p1(/명$|성명|성함|이름|name|^(발송인|보내는분|보내는사람|송하인|주문자|주문인|신청인)$/i, /주소|우편|전화|연락|휴대|번호|일자|날짜|이메일|메일|금액|수량|상품/);
    x.sMobile = p1(/휴대|핸드폰|모바일|H\.?P|mobile|cell/i, null);
    x.sTel = p1(/전화|연락처|tel|phone/i, /휴대|핸드폰|모바일|H\.?P|mobile|cell/i);
    if (x.sTel === x.sMobile) {
      x.sTel = -1;
    }
    x.sZip = p1(r1, null);
    if (x.sZip < 0 && x.sAddr >= 0) {
      x.sZip = q1(r1, s1, x.sAddr, x.addr);
    }
    var t1 = [x.sName, x.sZip, x.sAddr, x.sAddr2, x.sTel, x.sMobile].filter(function (k) {
      return k >= 0;
    });
    var u1 = q1(r1, y, x.addr.length ? x.addr[0] : -1, t1);
    if (u1 < 0) {
      var v1 = 0;
      s.forEach(function (b2, idx) {
        if (b2 >= 0.6 && b2 > v1 && x.addr.indexOf(idx) < 0) {
          v1 = b2;
          u1 = idx;
        }
      });
    }
    x.zip = u1;
    // 기관 발송 명단에 흔한 머리글(수신자·대상자 등)은 그 낱말만 있을 때 받는 분으로 본다(「수신자 주소」 같은 머리글은 제외)
    x.name = v(/성명|성함|이름|수취인|수신인|받는\s*(분|사람|이)|받을\s*(분|사람|이)|수령|고객명|상호|업체명|기관명|거래처|name|^(수신자|대상자|민원인|납세자|세대주)(명|성명|이름)?$/i, /발송|보내는|송하인|주문자|신청인|주소|우편|전화|연락|휴대|번호|이메일|메일/);
    if (x.name < 0) {
      for (i = 0; i < d; i++) {
        if (x.addr.indexOf(i) >= 0 || i === x.zip || i === x.addr2 || t1.indexOf(i) >= 0) {
          continue;
        }
        var w1 = f[i] || "";
        if (w1 && /주소|우편|전화|연락|휴대|상품|품명|물품|메모|비고|메시지|메세지|수량|금액|번호|일자|날짜/.test(w1)) {
          continue;
        }
        var x1 = p(i);
        if (x1.length < Math.max(1, g.length * 0.5)) {
          continue;
        }
        var y1 = x1.filter(function (b2) {
          return /^[가-힣]{2,4}$/.test(b2) || /^[가-힣]{2,6}\s?[가-힣]{0,4}$/.test(b2) && b2.length <= 7 && !/[동리로길읍면군구시]$/.test(b2);
        }).length;
        if (y1 / x1.length >= 0.8) {
          x.name = i;
          break;
        }
      }
    }
    x.mobile = v(/휴대|핸드폰|이동통신|모바일|H\.?P|mobile|cell/i, y);
    x.tel = v(/전화|연락처|tel|phone/i, /휴대|핸드폰|이동통신|모바일|발송|보내는|송하인|주문자/i);
    if (x.tel === x.mobile) {
      x.tel = -1;
    }
    if (x.tel < 0 && x.mobile < 0) {
      for (i = 0; i < d; i++) {
        if (x.addr.indexOf(i) >= 0 || i === x.zip || i === x.addr2 || i === x.name || t1.indexOf(i) >= 0) {
          continue;
        }
        var z1 = p(i);
        if (z1.length < Math.max(1, g.length * 0.5)) {
          continue;
        }
        var a2 = z1.filter(function (b2) {
          var c2 = b2.replace(/[^\d]/g, "");
          return /^\d{9,11}$/.test(c2) && /^0/.test(c2) && /^[\d\-() ]+$/.test(b2);
        }).length;
        if (a2 / z1.length >= 0.8) {
          if (isMobile(z1[0])) {
            x.mobile = i;
          } else {
            x.tel = i;
          }
          break;
        }
      }
    }
    x.item = v(/상품|품명|내용품|물품/, /수량|금액|단가|코드|번호/);
    x.memo = v(/메시지|메세지|메모|요청|비고/, null);
    x.qty = v(/수량|개수|박스수|qty|^ea$/i, /단가|금액|합계/);
    S.cols = x;
    S.scores = r;
  }
  var COL_FIELDS = [{
    key: "addr",
    label: "주소",
    req: true
  }, {
    key: "addr2",
    label: "상세주소"
  }, {
    key: "zip",
    label: "우편번호(있으면)"
  }, {
    key: "name",
    label: "받는 분"
  }, {
    key: "tel",
    label: "전화"
  }, {
    key: "mobile",
    label: "휴대전화"
  }, {
    key: "item",
    label: "상품명"
  }, {
    key: "memo",
    label: "배송 메시지"
  }, {
    key: "qty",
    label: "수량"
  }, {
    key: "sName",
    label: "보내는 분 이름",
    grp: "s"
  }, {
    key: "sZip",
    label: "보내는 분 우편번호",
    grp: "s"
  }, {
    key: "sAddr",
    label: "보내는 분 주소",
    grp: "s"
  }, {
    key: "sAddr2",
    label: "보내는 분 상세주소",
    grp: "s"
  }, {
    key: "sTel",
    label: "보내는 분 전화",
    grp: "s"
  }, {
    key: "sMobile",
    label: "보내는 분 휴대전화",
    grp: "s"
  }];
  function hasSenderCols() {
    var C = S.cols;
    return C.sName >= 0 || C.sAddr >= 0;
  }
  function colOptionLabel(a) {
    var b = S.headerIdx >= 0 ? clean(S.aoa[S.headerIdx][a]) : "";
    return colLetter(a) + "열" + (b ? " · " + (b.length > 18 ? b.slice(0, 18) + "…" : b) : "");
  }
  function openSheet(a) {
    if (!S.aoa.length) {
      qs("#step2").hidden = true;
      return setMsg(qs("#fileMsg"), "시트에 내용이 없습니다.", "warn");
    }
    S.headerAuto = "";
    S.headerIdx = findHeaderRow(S.aoa);
    detectColumns();
    if (checkFirstRowHeader()) {
      detectColumns();
    }
    var selSheetEl = qs("#selSheet");
    selSheetEl.innerHTML = "";
    var b = S.wb ? S.wb.SheetNames : [a];
    b.forEach(function (d) {
      var f = document.createElement("option");
      f.value = d;
      f.textContent = d;
      if (d === (S.wb ? S.sheet : a)) {
        f.selected = true;
      }
      selSheetEl.appendChild(f);
    });
    qs("#sheetField").hidden = b.length < 2;
    var selHeaderEl = qs("#selHeader");
    selHeaderEl.innerHTML = "<option value=\"-1\">제목 줄 없음 (1행부터 자료)</option>";
    for (var i = 0; i < Math.min(S.aoa.length, 25); i++) {
      var c = document.createElement("option");
      c.value = i;
      c.textContent = i + 1 + "행: " + S.aoa[i].map(clean).filter(Boolean).slice(0, 5).join(" | ").slice(0, 60);
      if (i === S.headerIdx) {
        c.selected = true;
      }
      selHeaderEl.appendChild(c);
    }
    qs("#fileLabel").textContent = S.fileName + " · " + fmtNum(S.aoa.length - (S.headerIdx + 1)) + "행";
    renderColMap();
    renderPreview();
    qs("#step2").hidden = false;
    qs("#step3").hidden = true;
    qs("#step4").hidden = true;
    if (!S.cols.addr.length) {
      setMsg(qs("#fileMsg"), "주소 열을 자동으로 찾지 못했습니다. 아래 「주소」 칸에서 직접 골라 주세요. 시·군이 빠진 주소록이면 검색 옵션의 기본 지역을 먼저 적어 주세요.", "warn");
    } else if (S.headerIdx >= 0) {
      setMsg(qs("#fileMsg"), (S.headerAuto || S.headerIdx + 1 + "행을 제목 줄로 보고 빼고 검색합니다.") + " 아니면 「제목 줄」에서 바꾸세요." + (hasSenderCols() ? " 보내는 분(주문자) 열도 찾았습니다 · 보내는 분 주소의 우편번호도 함께 찾습니다." : ""), "ok");
    }
    qs("#step2").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
  function renderColMap() {
    var colMapEl = qs("#colMap");
    colMapEl.innerHTML = "";
    var a = false;
    COL_FIELDS.forEach(function (b) {
      if (b.grp === "s" && !a) {
        a = true;
        var c = document.createElement("div");
        c.className = "sub-h";
        c.style.gridColumn = "1/-1";
        c.style.margin = "8px 0 0";
        c.textContent = "보내는 분(주문자) · 파일에 있으면 우체국쇼핑 양식에 행마다 따로 넣습니다";
        colMapEl.appendChild(c);
      }
      var d = document.createElement("div");
      d.className = "field" + (b.req ? " req" : "");
      var f = "col_" + b.key;
      var g = "<label for=\"" + f + "\">" + escHtml(b.label) + "</label><select id=\"" + f + "\">";
      g += "<option value=\"\">" + (b.req ? "(고르세요)" : "(없음)") + "</option>";
      if (b.key === "addr" && S.cols.addr.length > 1) {
        g += "<option value=\"" + S.cols.addr.join(",") + "\" selected>" + colLetter(S.cols.addr[0]) + "~" + colLetter(S.cols.addr[S.cols.addr.length - 1]) + "열 합치기</option>";
      }
      for (var i = 0; i < S.ncol; i++) {
        var h = b.key === "addr" ? S.cols.addr.length === 1 && S.cols.addr[0] === i : S.cols[b.key] === i;
        g += "<option value=\"" + i + "\"" + (h ? " selected" : "") + ">" + escHtml(colOptionLabel(i)) + "</option>";
      }
      d.innerHTML = g + "</select>";
      colMapEl.appendChild(d);
      qs("select", d).onchange = function () {
        var p = this.value;
        if (b.key === "addr") {
          S.cols.addr = p === "" ? [] : p.split(",").map(Number);
        } else {
          S.cols[b.key] = p === "" ? -1 : Number(p);
        }
        renderPreview();
      };
    });
  }
  function renderPreview() {
    var previewTableEl = qs("#previewTable");
    var a = S.headerIdx;
    var b = S.aoa.slice(a + 1, a + 7);
    var c = "<thead><tr>";
    var d = {};
    var f = {};
    S.cols.addr.forEach(function (h) {
      d[h] = "주소";
      f[h] = "addr";
    });
    COL_FIELDS.slice(1).forEach(function (h) {
      if (S.cols[h.key] >= 0 && !d[S.cols[h.key]]) {
        d[S.cols[h.key]] = h.label.replace("(있으면)", "");
        f[S.cols[h.key]] = h.key;
      }
    });
    function g(h) {
      if (d[h] === "주소") {
        return "hl";
      } else if (d[h]) {
        return "hl2";
      } else {
        return "";
      }
    }
    for (var i = 0; i < S.ncol; i++) {
      c += "<th class=\"" + g(i) + "\">" + (d[i] ? "<small>" + escHtml(d[i]) + "</small>" : "") + escHtml(colOptionLabel(i)) + "</th>";
    }
    c += "</tr></thead><tbody>";
    b.forEach(function (h) {
      c += "<tr>";
      for (var j = 0; j < S.ncol; j++) {
        c += "<td class=\"" + g(j) + "\">" + escHtml(maskByKind(clean(h[j]), f[j] || (looksLikeAddress(clean(h[j])) ? "addr" : ""))) + "</td>";
      }
      c += "</tr>";
    });
    previewTableEl.innerHTML = c + "</tbody>";
  }
  function regionOpts() {
    var a = clean(qs("#optRegion").value);
    var b = a && S.engine ? S.engine.parseRegion(a) : [];
    if (b.length) {
      return {
        defaultSggs: b
      };
    } else {
      return null;
    }
  }
  function paintRegionMsg() {
    var a = clean(qs("#optRegion").value);
    var regionMsgEl = qs("#regionMsg");
    if (!a || !S.engine) {
      regionMsgEl.textContent = "";
      regionMsgEl.className = "fmsg";
      return;
    }
    var b = S.engine.parseRegion(a);
    if (b.length) {
      regionMsgEl.textContent = "적용: " + b.map(function (c) {
        return S.engine.sggLabel(c);
      }).slice(0, 4).join(", ") + (b.length > 4 ? " 외" : "");
      regionMsgEl.className = "fmsg good";
    } else {
      regionMsgEl.textContent = "시·군·구를 알아보지 못했습니다. 예) 전북특별자치도 정읍시";
      regionMsgEl.className = "fmsg bad";
    }
  }
  function normZip(a) {
    var b = clean(a).replace(/[^\d]/g, "");
    if (b.length === 4) {
      b = "0" + b;
    }
    return b;
  }
  function isKnownZip(a) {
    return /^\d{5}$/.test(a) && S.engine.zipSet().has(parseInt(a, 10));
  }
  function deliveryOffice(a) {
    if (S.engine && a) {
      return S.engine.office(a);
    } else {
      return "";
    }
  }
  function applyZipPolicy(a, b) {
    var c = a.r;
    var d = a.old;
    var f = isKnownZip(d);
    a.status = c.grade;
    a.conf = c.conf;
    a.note = c.note;
    a.zip = c.zip;
    if (c.grade === "정확") {
      if (b === "fill" && f) {
        a.zip = d;
        if (d !== c.zip) {
          a.note += " · 기존 " + d + " 유지(검색값 " + c.zip + ")";
        }
      } else if (d && d !== c.zip) {
        a.note += " · 기존 " + d + " → 교체";
      }
    } else if (c.grade === "유사") {
      var g = f && (!c.canon || c.canon.g === undefined || S.engine.sggHasZip(c.canon.g, d));
      if (f && b === "fill") {
        g = true;
      }
      if (g && b !== "replace") {
        a.zip = d;
        if (d !== c.zip) {
          a.note = "기존 우편번호 유지(추정값 " + c.zip + ") · " + c.note;
        } else {
          a.note = "기존 우편번호와 같음 · " + c.note;
        }
      } else if (d && d !== c.zip) {
        a.note += " · 기존 " + d + (f ? "은(는) 다른 지역 번호라 교체" : " → 교체");
      }
    } else if (f) {
      a.zip = d;
      a.note += " · 기존 우편번호 유지";
    } else {
      a.zip = "";
      if (d) {
        a.note += " · 기존 " + d + "은(는) 현행 번호가 아니라 비움";
      }
    }
    a.changed = !!d && !!a.zip && d !== a.zip;
    if (a.changed) {
      var h = deliveryOffice(a.zip);
      var p = deliveryOffice(a.old);
      if (h && p) {
        a.note += h === p ? " · 배달국은 " + h + "으로 같음" : " · 배달국 다름(" + p + "→" + h + ")";
      }
    }
  }
  function lookupWithDetail(a, d, o) {
    if (!a && !d) {
      return {
        zip: "",
        grade: "실패",
        conf: "",
        note: "주소가 비어 있음",
        addr1: "",
        addr2: "",
        score: 0
      };
    }
    if (!d || a.indexOf(d) >= 0) {
      return S.engine.lookup(a, o);
    }
    var x = a ? S.engine.lookup(a, o) : null;
    if (x && x.grade === "정확") {
      x.addr2 = [x.addr2, d].filter(Boolean).join(" ");
      return x;
    }
    var y = S.engine.lookup((a + " " + d).trim(), o);
    if (x && x.score >= y.score) {
      x.addr2 = [x.addr2, d].filter(Boolean).join(" ");
      return x;
    }
    return y;
  }
  function runSearch() {
    if (!S.cols.addr.length) {
      return setMsg(qs("#fileMsg"), "「주소」 열을 먼저 골라 주세요.", "warn");
    }
    setMsg(qs("#fileMsg"), "");
    var a = S.aoa;
    var b = S.headerIdx + 1;
    var c = regionOpts();
    var d = qs("#optZipPolicy").value;
    settings.set({
      region: qs("#optRegion").value,
      zipPolicy: d
    });
    var f = [];
    var g = b;
    var h = performance.now();
    setBusy(true, "우편번호를 찾는 중…", 0);
    function p() {
      var q = Math.min(g + 3000, a.length);
      for (; g < q; g++) {
        var r = a[g];
        if (!r.some(function (d1) {
          return clean(d1);
        })) {
          continue;
        }
        var s = S.cols.addr.map(function (d1) {
          return clean(r[d1]);
        }).filter(Boolean).join(" ");
        var t = S.cols.addr2 >= 0 ? clean(r[S.cols.addr2]) : "";
        var u = {
          i: g,
          addr: s,
          detail: t,
          old: "",
          edited: false
        };
        var v = u;
        if (!s && !t) {
          var w = {
            zip: "",
            grade: "실패",
            conf: "",
            note: "주소가 비어 있음",
            addr1: "",
            addr2: "",
            score: 0
          };
          v.r = w;
        } else if (!t || s.indexOf(t) >= 0) {
          v.r = S.engine.lookup(s, c);
        } else {
          var x = s ? S.engine.lookup(s, c) : null;
          if (x && x.grade === "정확") {
            x.addr2 = [x.addr2, t].filter(Boolean).join(" ");
            v.r = x;
          } else {
            var y = S.engine.lookup((s + " " + t).trim(), c);
            if (x && x.score >= y.score) {
              x.addr2 = [x.addr2, t].filter(Boolean).join(" ");
              v.r = x;
            } else {
              v.r = y;
            }
          }
        }
        var z = S.cols.zip >= 0 ? normZip(r[S.cols.zip]) : "";
        v.old = z || (v.r.zipFound ? normZip(v.r.zipFound) : "");
        var a1 = S.cols;
        if (a1.sAddr >= 0 || a1.sName >= 0) {
          var b1 = function (k) {
            return a1[k] >= 0 ? clean(r[a1[k]]) : "";
          };
          var c1 = {
            name: b1("sName"),
            addr: b1("sAddr"),
            detail: b1("sAddr2"),
            tel: b1("sTel"),
            mobile: b1("sMobile"),
            old: "",
            zip: "",
            status: "",
            note: ""
          };
          if (c1.addr || c1.detail) {
            c1.r = lookupWithDetail(c1.addr, c1.detail, c);
            c1.old = a1.sZip >= 0 ? normZip(r[a1.sZip]) : "";
            if (!c1.old && c1.r.zipFound) {
              c1.old = normZip(c1.r.zipFound);
            }
            applyZipPolicy(c1, d);
          }
          if (c1.name || c1.addr || c1.detail || c1.tel || c1.mobile) {
            v.s = c1;
          }
          if (!s && !t && c1.r) {
            v.addr = c1.addr;
            v.detail = c1.detail;
            v.r = lookupWithDetail(c1.addr, c1.detail, c);
            v.old = c1.old;
            v.self = true;
          }
        }
        applyZipPolicy(v, d);
        if (v.self) {
          v.note = "본인 수령(받는 분 칸이 비어 보내는 분 주소 사용) · " + v.note;
        }
        if (v.s && v.s.r && v.s.status !== "정확" && !v.self) {
          v.note += " · 보내는 분 주소 " + (v.s.status === "유사" ? "유사·" + v.s.conf : "못 찾음");
        }
        f.push(v);
      }
      setBusy(true, "우편번호를 찾는 중… " + fmtNum(g - b) + " / " + fmtNum(a.length - b), (g - b) / Math.max(1, a.length - b));
      if (g < a.length) {
        setTimeout(p, 0);
      } else {
        S.rows = f;
        S.elapsed = performance.now() - h;
        setBusy(false);
        addLog("우편번호 검색", f.length, S.fileName || "직접 입력");
        showResults();
      }
    }
    setTimeout(p, 30);
  }
  function gradeBadge(a) {
    if (a.edited) {
      return "<span class=\"badge g-edit\">수정</span>";
    }
    if (a.status === "정확") {
      return "<span class=\"badge g-ok\">정확</span>";
    }
    if (a.status === "유사") {
      return "<span class=\"badge " + (a.conf === "하" ? "g-sim2" : "g-sim") + "\">유사·" + escHtml(a.conf) + "</span>";
    }
    return "<span class=\"badge g-fail\">실패</span>";
  }
  function countGrades() {
    var a = {
      all: S.rows.length,
      ok: 0,
      s1: 0,
      s2: 0,
      s3: 0,
      fail: 0,
      changed: 0,
      edited: 0,
      nozip: 0
    };
    var b = a;
    S.rows.forEach(function (row) {
      if (row.status === "정확") {
        b.ok++;
      } else if (row.status === "유사") {
        if (row.conf === "상") {
          b.s1++;
        } else if (row.conf === "중") {
          b.s2++;
        } else {
          b.s3++;
        }
      } else {
        b.fail++;
      }
      if (row.changed) {
        b.changed++;
      }
      if (row.edited) {
        b.edited++;
      }
      if (!row.zip) {
        b.nozip++;
      }
    });
    return b;
  }
  var RESULT_FILTERS = [["all", "전체", function () {
    return true;
  }], ["ok", "정확", function (a) {
    return a.status === "정확";
  }], ["sim", "유사", function (a) {
    return a.status === "유사";
  }], ["low", "유사·하", function (a) {
    return a.status === "유사" && a.conf === "하";
  }], ["fail", "실패", function (a) {
    return a.status === "실패";
  }], ["changed", "기존 번호와 다름", function (a) {
    return a.changed;
  }], ["nozip", "우편번호 없음", function (a) {
    return !a.zip;
  }]];
  var GRADE_ORDER = {
    정확: 0,
    유사상: 1,
    유사중: 2,
    유사하: 3,
    실패: 4
  };
  var SORTERS = {
    no: function (a, b) {
      return a.i - b.i;
    },
    zip: function (a, b) {
      return (a.zip || "~").localeCompare(b.zip || "~") || a.i - b.i;
    },
    grade: function (a, b) {
      return (GRADE_ORDER[a.status + (a.conf || "")] || 9) - (GRADE_ORDER[b.status + (b.conf || "")] || 9) || a.i - b.i;
    },
    addr: function (a, b) {
      return String(a.addr).localeCompare(String(b.addr), "ko") || a.i - b.i;
    }
  };
  function visibleRows() {
    var a = RESULT_FILTERS.filter(function (c) {
      return c[0] === S.filter;
    })[0] || RESULT_FILTERS[0];
    var b = S.rows.filter(a[2]);
    if (S.sort && SORTERS[S.sort]) {
      b = b.slice().sort(SORTERS[S.sort]);
      if (S.sortDesc) {
        b.reverse();
      }
    }
    return b;
  }
  function toggleSort(a) {
    if (S.sort === a) {
      if (S.sortDesc) {
        S.sort = "no";
        S.sortDesc = false;
      } else {
        S.sortDesc = true;
      }
    } else {
      S.sort = a;
      S.sortDesc = false;
    }
    qsa("#resultTable thead th[data-sort]").forEach(function (b) {
      b.className = b.className.replace(/\s*sorted(-desc)?/g, "") + (b.dataset.sort === S.sort ? S.sortDesc ? " sorted-desc" : " sorted" : "");
    });
    renderTable(true);
  }
  function renderSummary() {
    var a = countGrades();
    var b = Math.max(1, a.all);
    function c(h) {
      return (h / b * 100).toFixed(1) + "%";
    }
    qs("#tiles").innerHTML = "<div class=\"tile\"><b>" + fmtNum(a.all) + "</b><span>전체 주소</span></div><div class=\"tile t-ok\"><b>" + fmtNum(a.ok) + "</b><span>정확 · " + c(a.ok) + "</span></div><div class=\"tile t-sim\"><b>" + fmtNum(a.s1 + a.s2 + a.s3) + "</b><span>유사 · 상 " + fmtNum(a.s1) + " / 중 " + fmtNum(a.s2) + " / 하 " + fmtNum(a.s3) + "</span></div><div class=\"tile t-fail\"><b>" + fmtNum(a.fail) + "</b><span>실패 · 우편번호 없음 " + fmtNum(a.nozip) + "</span></div>";
    qs("#ratioBar").innerHTML = "<i class=\"b-ok\" style=\"width:" + c(a.ok) + "\"></i><i class=\"b-s1\" style=\"width:" + c(a.s1 + a.s2) + "\"></i><i class=\"b-s2\" style=\"width:" + c(a.s3) + "\"></i><i class=\"b-fail\" style=\"width:" + c(a.fail) + "\"></i>";
    var filtersEl = qs("#filters");
    filtersEl.innerHTML = "";
    var d = {
      all: a.all,
      ok: a.ok,
      sim: a.s1 + a.s2 + a.s3,
      low: a.s3,
      fail: a.fail,
      changed: a.changed,
      nozip: a.nozip
    };
    var f = d;
    RESULT_FILTERS.forEach(function (h) {
      if (h[0] !== "all" && !f[h[0]]) {
        return;
      }
      var p = document.createElement("button");
      p.type = "button";
      p.className = "chip" + (S.filter === h[0] ? " on" : "");
      p.textContent = h[1] + " " + fmtNum(f[h[0]]);
      p.onclick = function () {
        S.filter = h[0];
        S.shown = 0;
        renderSummary();
        renderTable(true);
      };
      filtersEl.appendChild(p);
    });
    var g = document.createElement("button");
    g.type = "button";
    g.className = "chip mask" + (privacyMask.on ? " on" : "");
    g.textContent = privacyMask.on ? "가림 켜짐" : "가림 꺼짐 · 노출 주의";
    g.title = "이름·전화·번지와 상세주소를 화면에서만 가립니다. 내려받는 파일에는 원래 값이 들어갑니다.";
    g.onclick = function () {
      privacyMask.on = !privacyMask.on;
      var h = {
        mask: privacyMask.on
      };
      settings.set(h);
      if (!privacyMask.on) {
        addLog("가림 해제", S.rows.length, "전체");
      } else {
        addLog("가림 켬", 0, "");
      }
      privacyMask.reveal = {};
      renderSummary();
      renderTable(true);
      if (!privacyMask.on) {
        setMsg(qs("#dlMsg"), "화면 가림을 풀었습니다. 다른 사람이 볼 수 있는 자리인지 확인하세요. 이 사실은 처리 이력에 남습니다.", "warn");
      }
    };
    filtersEl.appendChild(g);
  }
  function rowHtml(a) {
    var b = [a.r.addr1, a.r.addr2].filter(Boolean).join(" ");
    var c = deliveryOffice(a.zip);
    var d = privacyMask.on && !privacyMask.reveal[a.i];
    return "<tr data-i=\"" + a.i + "\"" + (d ? " class=\"masked\"" : "") + "><td class=\"c-no\">" + (a.i + 1) + (d ? "<button type=\"button\" class=\"eye\" title=\"" + privacyMask.SECONDS + "초 동안 이 줄만 보기\">보기</button>" : "") + "</td><td>" + escHtml(maskedValue(a, a.addr, "addr")) + (a.detail ? " <span class=\"note\">" + escHtml(maskedValue(a, a.detail, "addr2")) + "</span>" : "") + "</td><td class=\"c-zip\"><input class=\"zipin" + (a.edited ? " edited" : "") + "\" type=\"text\" inputmode=\"numeric\" maxlength=\"5\" value=\"" + escHtml(a.zip) + "\" aria-label=\"" + (a.i + 1) + "행 우편번호\">" + (c ? "<span class=\"off\">" + escHtml(c) + "</span>" : "") + (a.old && a.old !== a.zip ? "<span class=\"was\">기존 " + escHtml(a.old) + "</span>" : "") + "</td><td class=\"c-gr\">" + gradeBadge(a) + "<button type=\"button\" class=\"findbtn\" title=\"주소 찾기로 고치기\">찾기</button></td><td class=\"note\">" + escHtml(a.note) + "</td><td>" + (a.status === "실패" ? "" : escHtml(maskedValue(a, b, "addr"))) + "</td></tr>";
  }
  function refreshRow(a) {
    var b = qs("#resultTable tbody tr[data-i=\"" + a + "\"]");
    var c = S.rows.filter(function (row) {
      return row.i === a;
    })[0];
    if (!b || !c) {
      return;
    }
    var d = document.createElement("tbody");
    d.innerHTML = rowHtml(c);
    b.parentNode.replaceChild(d.firstChild, b);
  }
  function renderTable(a) {
    var b = visibleRows();
    var c = qs("#resultTable tbody");
    if (a) {
      c.innerHTML = "";
      S.shown = 0;
    }
    var d = b.slice(S.shown, S.shown + TABLE_PAGE);
    c.insertAdjacentHTML("beforeend", d.map(rowHtml).join(""));
    S.shown += d.length;
    var btnMoreEl = qs("#btnMore");
    btnMoreEl.hidden = S.shown >= b.length;
    btnMoreEl.textContent = "더 보기 (" + fmtNum(S.shown) + " / " + fmtNum(b.length) + ")";
  }
  function showResults() {
    S.filter = "all";
    qs("#runInfo").textContent = fmtNum(S.rows.length) + "건 · " + (S.elapsed / 1000).toFixed(2) + "초";
    renderSummary();
    renderTable(true);
    renderPresets();
    var a = S.rows.filter(function (row) {
      return row.status === "실패" && /^시·도와/.test(row.r.note || "");
    }).length;
    setMsg(qs("#fileMsg"), a >= 3 && !clean(qs("#optRegion").value) ? "시·군·구가 빠진 주소가 " + fmtNum(a) + "건 있습니다. 한 지역 주소록이라면 「열 확인 ▸ 검색 옵션 ▸ 기본 지역」에 시·군을 적고 다시 검색해 보세요." : "", "warn");
    qs("#step3").hidden = false;
    qs("#step4").hidden = false;
    qs("#step3").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
  var EPOST_HEADERS = ["발송인명\n(띄어쓰기 포함 \n16자 이내)", "우편번호\n(예시:06267)", "발송인주소1 - 동/읍/면/로 까지\n① 예시1 : 서울특별시 영등포구 영중로83\n② 예시2 : 경기도 가평군 가평읍\n\n특수문자 입력 금지 [ | \\ \" ' < > & ] ", "발송인주소2(나머지주소-필수입력)\n① 예시1 : 한국우편사업진흥원\n② 예시2 : 개곡리 123-4번지\n③ 예시3 : 나머지 주소가 없을 때 임의문자 한 글자라도 추가 ( 점 (.)표시)\n\n특수문자 입력 금지 [ | \\ \" ' < > & ] ", "발송인 일반전화\n(예시:02-1234-4567)\n\n* 발송인 일반전화 또는 \n휴대전화 중 1개만 입력", "발송인 휴대전화\n(예시:010-1234-4567)\n\n* 발송인 일반전화 또는 \n휴대전화 중 1개만 입력", "수취인명\n(띄어쓰기 포함\n 15자 이내)", "우편번호\n(예시:06267)", "수취인주소1 - 동/읍/면/로 까지\n① 예시1 : 서울특별시 영등포구 영중로83\n② 예시2 : 경기도 가평군 가평읍\n\n특수문자 입력 금지 [ | \\ \" ' < > & ] ", "수취인주소2(나머지주소-필수입력)\n① 예시1 : 한국우편사업진흥원\n② 예시2 : 개곡리 123-4번지\n③ 예시3 : 나머지 주소가 없을 때 임의문자 한 글자라도 추가 ( 점 (.)표시)\n\n특수문자 입력 금지 [ | \\ \" ' < > & ] ", "받는분 일반전화\n(예시:02-1234-4567)\n\n* 받는분 일반전화 또는 휴대전화 중 1개만 입력", "받는분 휴대전화\n(예시:010-1234-4567)\n\n* 받는분 일반전화 또는 휴대전화 중 1개만 입력"];
  var EPOST_SOURCES = ["senderName", "senderZip", "senderAddr1", "senderAddr2", "senderTelOnly", "senderMobile", "name", "zip", "addr1", "addr2", "telOnly", "mobile1"];
  var CUSTOM_SOURCES = [["name", "받는 분"], ["zip", "우편번호"], ["addrFull", "주소(전체)"], ["addr1", "주소1(기본)"], ["addr2", "주소2(상세)"], ["phone", "전화(휴대전화 우선)"], ["tel", "일반전화"], ["mobile", "휴대전화"], ["item", "상품명"], ["memo", "배송 메시지"], ["seq", "일련번호"], ["const", "고정값(오른쪽 칸)"], ["blank", "빈칸"], ["grade", "검색결과"], ["note", "근거"], ["office", "배달 우체국"], ["senderName", "보내는 분 이름"], ["senderZip", "보내는 분 우편번호"], ["senderAddr1", "보내는 분 주소1"], ["senderAddr2", "보내는 분 주소2"], ["senderAddrFull", "보내는 분 주소(전체)"], ["senderPhone", "보내는 분 전화"]];
  var PRESETS = {
    orig: {
      name: "원본 + 우편번호",
      desc: "원본 표를 그대로 두고 우편번호와 검색결과를 채웁니다",
      formats: ["xlsx", "csv"]
    },
    epost: {
      name: "우체국쇼핑 여러곳배송",
      desc: "사용자 양식의 예시 · 복수배송지 epost_order 12열 · 300건씩 나눔",
      formats: ["xls", "xlsx"],
      sheet: "epost_order",
      sender: true,
      sanitize: true,
      dot: true,
      split: 300,
      cols: EPOST_HEADERS.map(function (a, idx) {
        var b = {
          h: a,
          src: EPOST_SOURCES[idx],
          def: ""
        };
        return b;
      })
    },
    biz: {
      name: "계약소포 파일등록",
      desc: "사용자 양식의 예시 · 계약고객 전용시스템 제공 파일구조 · 5,000건씩 나눔",
      formats: ["xlsx", "xls"],
      sheet: "Sheet1",
      split: 5000,
      cols: [{
        h: "박스단위",
        src: "const",
        def: "1"
      }, {
        h: "상품명",
        src: "item",
        def: ""
      }, {
        h: "수취인명",
        src: "name",
        def: ""
      }, {
        h: "수취인 우편번호",
        src: "zip",
        def: ""
      }, {
        h: "수취인 주소",
        src: "addrFull",
        def: ""
      }, {
        h: "수취인 전화번호",
        src: "phone",
        def: ""
      }]
    },
    custom: {
      name: "사용자 지정 양식",
      desc: "창구접수·간편사전접수 등 · 양식 파일을 넣어 열 구성을 그대로 따라갑니다",
      formats: ["xlsx", "xls", "csv"],
      sheet: "Sheet1",
      custom: true,
      cols: []
    }
  };
  function normPhone(a) {
    var b = clean(a);
    if (!b) {
      return "";
    }
    var c = b.replace(/[^\d]/g, "");
    if (/^1\d{8,9}$/.test(c) || /^[2-6]\d{7,9}$/.test(c)) {
      c = "0" + c;
    }
    var d;
    if (d = c.match(/^(02)(\d{3,4})(\d{4})$/)) {
      return d[1] + "-" + d[2] + "-" + d[3];
    }
    if (d = c.match(/^(0\d{2})(\d{3,4})(\d{4})$/)) {
      return d[1] + "-" + d[2] + "-" + d[3];
    }
    if (d = c.match(/^(0\d{3})(\d{3,4})(\d{4})$/)) {
      return d[1] + "-" + d[2] + "-" + d[3];
    }
    if (d = c.match(/^(1[5-9]\d{2})(\d{4})$/)) {
      return d[1] + "-" + d[2];
    }
    return b;
  }
  function isMobile(a) {
    return /^01[016789]/.test(a.replace(/[^\d]/g, ""));
  }
  function readSenderForm() {
    return {
      name: clean(qs("#sdName") && qs("#sdName").value),
      zip: clean(qs("#sdZip") && qs("#sdZip").value),
      addr1: clean(qs("#sdAddr1") && qs("#sdAddr1").value),
      addr2: clean(qs("#sdAddr2") && qs("#sdAddr2").value),
      tel: normPhone(qs("#sdTel") && qs("#sdTel").value)
    };
  }
  function telPair(t, m) {
    var a = normPhone(t);
    var b = normPhone(m);
    if (!b && a && isMobile(a)) {
      b = a;
      a = "";
    }
    if (!a && b && !isMobile(b)) {
      a = b;
      b = "";
    }
    return [a, b];
  }
  function recipientOf(row) {
    var line = S.aoa[row.i] || [];
    var C = S.cols;
    function g(k) {
      if (C[k] >= 0) {
        return clean(line[C[k]]);
      } else {
        return "";
      }
    }
    var tp = telPair(g("tel"), g("mobile"));
    var name = g("name");
    if (row.self && row.s) {
      if (!name) {
        name = row.s.name || "";
      }
      if (!tp[0] && !tp[1]) {
        tp = telPair(row.s.tel, row.s.mobile);
      }
    }
    var found = row.status !== "실패" && row.r && row.r.addr1;
    return {
      name: name,
      tel: tp[0],
      mobile: tp[1],
      zip: row.zip || "",
      addr1: found ? row.r.addr1 : row.addr,
      addr2: found ? row.r.addr2 : row.detail
    };
  }
  function senderFromRecipient(rec) {
    return {
      name: rec.name,
      zip: rec.zip,
      addr1: rec.addr1,
      addr2: rec.addr2,
      tel: rec.mobile || rec.tel,
      src: "self"
    };
  }
  function senderFor(row, ctx, rec) {
    var fx = ctx.sender || {};
    var mode = ctx.mode || "fixed";
    if (mode === "self") {
      return senderFromRecipient(rec);
    }
    if (mode === "file") {
      var fb;
      if (ctx.fb === "fixed") {
        fb = Object.assign({}, fx);
        fb.src = "fixed";
      } else {
        fb = senderFromRecipient(rec);
      }
      var s = row.s;
      if (s && (s.name || s.addr || s.detail)) {
        var hasA = !!(s.addr || s.detail);
        var ok = hasA && s.r && s.status !== "실패" && s.r.addr1;
        var tp = telPair(s.tel, s.mobile);
        return {
          name: s.name || fb.name || "",
          zip: hasA ? s.zip || "" : fb.zip || "",
          addr1: hasA ? ok ? s.r.addr1 : s.addr : fb.addr1 || "",
          addr2: hasA ? ok ? s.r.addr2 : s.detail : fb.addr2 || "",
          tel: tp[1] || tp[0] || fb.tel || "",
          src: "file",
          bad: hasA && (!s.zip || s.status === "실패")
        };
      }
      return fb;
    }
    var f = Object.assign({}, fx);
    f.src = "fixed";
    return f;
  }
  function fieldValue(a, b, c, d) {
    var f = S.aoa[a.i] || [];
    var cur = d.cur && d.cur.row === a ? d.cur : null;
    var rec = cur ? cur.rec : recipientOf(a);
    var snd = cur ? cur.snd : senderFor(a, d, rec);
    function g(k) {
      var C = S.cols;
      if (C[k] >= 0) {
        return clean(f[C[k]]);
      } else {
        return "";
      }
    }
    var h = rec.tel;
    var p = rec.mobile;
    if (cur && cur.fillTel && !h && !p && snd.tel) {
      if (isMobile(snd.tel)) {
        p = snd.tel;
      } else {
        h = snd.tel;
      }
    }
    var st = snd.tel || "";
    switch (b) {
      case "name":
        return rec.name;
      case "zip":
        return a.zip;
      case "addr1":
        return rec.addr1;
      case "addr2":
        return rec.addr2;
      case "addrFull":
        return [rec.addr1, rec.addr2].filter(Boolean).join(" ");
      case "phone":
        return p || h;
      case "tel":
        return h;
      case "mobile":
        return p;
      case "telOnly":
        if (p) {
          return "";
        } else {
          return h;
        }
      case "mobile1":
        return p;
      case "item":
        return g("item");
      case "memo":
        return g("memo");
      case "seq":
        return String(d.seq);
      case "const":
        return c.def || "";
      case "blank":
        return "";
      case "grade":
        if (a.edited) {
          return "수정";
        } else {
          return a.status + (a.conf ? "·" + a.conf : "");
        }
      case "note":
        return a.note;
      case "office":
        return deliveryOffice(a.zip);
      case "senderName":
        return snd.name || "";
      case "senderZip":
        return snd.zip || "";
      case "senderAddr1":
        return snd.addr1 || "";
      case "senderAddr2":
        return snd.addr2 || "";
      case "senderAddrFull":
        return [snd.addr1, snd.addr2].filter(Boolean).join(" ");
      case "senderPhone":
        return st;
      case "senderTelOnly":
        if (isMobile(st)) {
          return "";
        } else {
          return st;
        }
      case "senderMobile":
        if (isMobile(st)) {
          return st;
        } else {
          return "";
        }
      default:
        if (/^orig:\d+$/.test(b)) {
          return clean(f[Number(b.slice(5))]);
        }
        return "";
    }
  }
  function optValue(id, d) {
    var e = qs("#" + id);
    if (e && !e.disabled) {
      return e.value;
    } else {
      return d;
    }
  }
  function optChecked(id, d) {
    var e = qs("#" + id);
    if (e) {
      return e.checked;
    } else {
      return !!d;
    }
  }
  function rowListText(a, n) {
    return a.join("·") + "행" + (n > a.length ? " 외" : "");
  }
  function buildPresetRows(a) {
    var isE = !!a.sender;
    var useS = isE || a.cols.some(function (c) {
      return /^sender/.test(c.src);
    });
    var ctx = {
      sender: readSenderForm(),
      seq: 0,
      mode: isE ? optValue("sdMode", hasSenderCols() ? "file" : "fixed") : "fixed",
      fb: optValue("sdFb", "self"),
      st: {
        fixed: 0,
        file: 0,
        self: 0,
        telFilled: 0
      }
    };
    if (!isE && ctx.mode !== "fixed") {
      ctx.mode = "fixed";
    }
    var fillTel = isE && optChecked("optFillTel", true);
    var useQty = isE && S.cols.qty >= 0 && optChecked("optQty", true);
    var skipFail = qs("#chkSkipFail").checked;
    var out = [];
    var meta = [];
    var W = {
      longName: 0,
      longRows: [],
      longSender: 0,
      nozip: 0,
      skipped: 0,
      empty: 0,
      emptyRows: [],
      noTel: 0,
      noTelRows: [],
      qtyAdded: 0,
      self: 0,
      sBad: 0,
      sBadRows: []
    };
    S.rows.forEach(function (row) {
      if (!row.addr && !row.detail) {
        W.empty++;
        if (W.emptyRows.length < 10) {
          W.emptyRows.push(row.i + 1);
        }
        return;
      }
      if (!row.zip) {
        W.nozip++;
        if (skipFail) {
          W.skipped++;
          return;
        }
      }
      var rec = recipientOf(row);
      var snd = senderFor(row, ctx, rec);
      var cur = {
        row: row,
        rec: rec,
        snd: snd,
        fillTel: fillTel
      };
      var n = 1;
      if (useQty) {
        var qv = S.aoa[row.i][S.cols.qty];
        var q = parseInt(String(qv == null ? "" : qv).replace(/[^\d]/g, ""), 10);
        if (q > 1) {
          n = Math.min(q, 999);
          W.qtyAdded += n - 1;
        }
      }
      if (useS) {
        ctx.st[snd.src || "fixed"] = (ctx.st[snd.src || "fixed"] || 0) + 1;
        if (snd.bad) {
          W.sBad++;
          if (W.sBadRows.length < 10) {
            W.sBadRows.push(row.i + 1);
          }
        }
        if ((snd.name || "").length > 16) {
          W.longSender++;
        }
      }
      if (row.self) {
        W.self++;
      }
      if (isE && !rec.tel && !rec.mobile) {
        if (fillTel && snd.tel) {
          ctx.st.telFilled++;
        } else {
          W.noTel++;
          if (W.noTelRows.length < 10) {
            W.noTelRows.push(row.i + 1);
          }
        }
      }
      if (a.sanitize && (rec.name || "").length > 15) {
        W.longName++;
        if (W.longRows.length < 10) {
          W.longRows.push(row.i + 1);
        }
      }
      for (var k = 0; k < n; k++) {
        ctx.seq++;
        ctx.cur = cur;
        out.push(a.cols.map(function (cd) {
          var v = fieldValue(row, cd.src, cd, ctx);
          v = v == null ? "" : String(v);
          if (!v && cd.def && cd.src !== "const") {
            v = cd.def;
          }
          if (a.sanitize) {
            v = v.replace(/[|\\"'<>&]/g, " ").replace(/\s+/g, " ").trim();
          }
          if (a.dot && /addr2$/i.test(cd.src) && !v) {
            v = ".";
          }
          return v;
        }));
        meta.push({
          i: row.i,
          item: S.cols.item >= 0 ? clean(S.aoa[row.i][S.cols.item]) : "",
          skey: [snd.name || "", snd.zip || "", snd.addr1 || ""].join("|")
        });
      }
      ctx.cur = null;
    });
    return {
      head: a.cols.map(function (c) {
        return c.h;
      }),
      rows: out,
      meta: meta,
      warn: W,
      st: ctx.st
    };
  }
  function buildOriginalWithZip(a, b, c) {
    var d = S.aoa;
    var f = S.headerIdx;
    var g = S.cols.zip;
    var h = g >= 0 ? -1 : S.cols.addr.length ? S.cols.addr[0] : 0;
    var p = {};
    S.rows.forEach(function (row) {
      p[row.i] = row;
    });
    var q = [];
    var r = [];
    var s = qs("#chkSkipFail").checked;
    for (var i = 0; i < d.length; i++) {
      var t = d[i].slice();
      var u = p[i];
      while (t.length < S.ncol) {
        t.push("");
      }
      if (u && s && !u.zip) {
        continue;
      }
      var v = [];
      if (i === f) {
        v = (a ? ["검색결과", "근거"] : []).concat(b ? ["정제 주소"] : []).concat(c ? ["배달 우체국"] : []);
      } else if (u) {
        v = (a ? [u.edited ? "수정" : u.status + (u.conf ? "·" + u.conf : ""), u.note] : []).concat(b ? [u.status === "실패" ? "" : [u.r.addr1, u.r.addr2].filter(Boolean).join(" ")] : []).concat(c ? [deliveryOffice(u.zip)] : []);
      }
      var w = i === f ? "우편번호" : u && !u.self ? u.zip : "";
      if (h >= 0) {
        t.splice(h, 0, w);
      } else if (u && !u.self) {
        t[g] = u.zip;
      }
      var x = S.cols.sZip;
      if (x >= 0 && i !== f && u && u.s && u.s.zip) {
        t[h >= 0 && x >= h ? x + 1 : x] = u.s.zip;
      }
      q.push(t.concat(v));
      r.push(i === f ? "head" : u ? u.edited ? "edit" : u.status === "정확" ? "" : u.status === "유사" ? u.conf === "하" ? "sim2" : "sim" : "fail" : "");
    }
    if (f < 0) {}
    var y = {
      aoa: q,
      marks: r,
      zipCol: h >= 0 ? h : g,
      extraFrom: S.ncol + (h >= 0 ? 1 : 0)
    };
    return y;
  }
  var XLS_FILLS = {
    head: "E8ECF2",
    sim: "FFF3D1",
    sim2: "FFE0C2",
    fail: "FDDCD9",
    edit: "DCE8FF"
  };
  function aoaToStyledSheet(a, b) {
    b = b || {};
    var c = {};
    var d = 0;
    var f = [];
    for (var i = 0; i < a.length; i++) {
      var g = a[i];
      for (var j = 0; j < g.length; j++) {
        var h = g[j] == null ? "" : String(g[j]);
        if (j + 1 > d) {
          d = j + 1;
        }
        var p = 0;
        for (var k = 0; k < h.length && k < 60; k++) {
          p += h.charCodeAt(k) > 255 ? 2 : 1;
        }
        var q = h.indexOf("\n") >= 0 ? Math.min(p, 24) : p;
        if (i >= (b.widthFrom || 0) && (!f[j] || q > f[j])) {
          f[j] = q;
        }
        if (h === "" && (!b.marks || !b.marks[i])) {
          continue;
        }
        var r = {
          t: "s",
          v: h
        };
        var s = r;
        var t = b.marks && b.marks[i];
        if (b.styled) {
          var u = {
            bold: true
          };
          var v = {
            rgb: XLS_FILLS.head
          };
          var w = {
            fgColor: v
          };
          var x = {
            vertical: "center",
            wrapText: true
          };
          var y = {
            font: u,
            fill: w,
            alignment: x
          };
          if (t === "head") {
            s.s = y;
          } else if (t && (j === b.zipCol || j >= b.extraFrom)) {
            s.s = {
              fill: {
                fgColor: {
                  rgb: XLS_FILLS[t]
                }
              }
            };
          }
        }
        var z = {
          r: i,
          c: j
        };
        c[XLSX.utils.encode_cell(z)] = s;
      }
    }
    c["!ref"] = XLSX.utils.encode_range({
      s: {
        r: 0,
        c: 0
      },
      e: {
        r: Math.max(0, a.length - 1),
        c: Math.max(0, d - 1)
      }
    });
    c["!cols"] = f.map(function (a1) {
      return {
        wch: Math.max(6, Math.min(48, (a1 || 6) + 2))
      };
    });
    return c;
  }
  function safeCell(a) {
    var b = a == null ? "" : String(a);
    if (!/^[=+\-@\t\r]/.test(b)) {
      return b;
    }
    if (/^[+\-]?[\d\s().\-]+$/.test(b)) {
      return b;
    }
    return "'" + b;
  }
  function safeFileName(a) {
    return String(a == null ? "" : a).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^[.\s]+/, "").slice(0, 80) || "주소록";
  }
  function downloadBlob(a, b, c) {
    var d = {
      type: c || "application/octet-stream"
    };
    var f = a instanceof Blob ? a : new Blob([a], d);
    var g = document.createElement("a");
    g.href = URL.createObjectURL(f);
    g.download = b;
    document.body.appendChild(g);
    g.click();
    setTimeout(function () {
      URL.revokeObjectURL(g.href);
      g.remove();
    }, 1500);
  }
  function writeWorkbook(a, b, c, d, f) {
    if (c === "csv") {
      var g = a.map(function (s) {
        return s.map(function (t) {
          t = safeCell(t);
          if (/[",\r\n]/.test(t)) {
            return "\"" + t.replace(/"/g, "\"\"") + "\"";
          } else {
            return t;
          }
        }).join(",");
      }).join("\r\n");
      return downloadBlob(String.fromCharCode(65279) + g, d + ".csv", "text/csv;charset=utf-8");
    }
    var h = XLSX.utils.book_new();
    var p = aoaToStyledSheet(a, f);
    h.Props = {
      Title: d,
      Subject: "개인정보 포함",
      Company: "우정사업본부",
      Author: APP.author,
      Manager: APP.author,
      Keywords: APP_CREDIT,
      // 줄바꿈을 넣으면 core.xml의 설명 칸에 xml:space 속성이 붙어 엑셀이 「복구」를 묻는다(2026-10-09 확인). 한 줄로 쓴다.
      Comments: "개인정보 포함 · 업무 목적 외 사용·제공·보관 금지. 용무가 끝나면 파기하세요. " + APP_CREDIT + " · " + dateLabel(todayYmd()) + " 생성"
    };
    if (f && f.overlay) {
      p = f.overlay(p);
    }
    XLSX.utils.book_append_sheet(h, p, b || "Sheet1");
    var q = {
      bookType: c === "xls" ? "biff8" : "xlsx",
      type: "array"
    };
    var r = XLSX.write(h, q);
    downloadBlob(r, d + "." + c, c === "xls" ? "application/vnd.ms-excel" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  }
  function baseName() {
    return safeFileName((S.fileName || "주소록").replace(/\.[^.]+$/, ""));
  }
  function currentPreset() {
    var a = PRESETS[S.preset];
    if (S.preset === "custom") {
      a = Object.assign({}, a, {
        cols: customColumns()
      });
    }
    return a;
  }
  function overlayOriginalCells(a, b) {
    var c = S.wb && S.wb.Sheets[S.sheet];
    if (!c || !c["!ref"] || qs("#chkSkipFail").checked) {
      return a;
    }
    var d = S.cols.zip >= 0 ? -1 : b.zipCol;
    Object.keys(c).forEach(function (f) {
      if (f.charAt(0) === "!") {
        return;
      }
      var g = XLSX.utils.decode_cell(f);
      var h = c[f];
      if (g.c > 255 || h.t !== "n") {
        return;
      }
      if (d < 0 && g.c === S.cols.zip) {
        return;
      }
      if (g.c === S.cols.sZip) {
        return;
      }
      var p = d >= 0 && g.c >= d ? g.c + 1 : g.c;
      var q = XLSX.utils.encode_cell({
        r: g.r,
        c: p
      });
      var r = a[q] && a[q].s;
      var s = {
        t: "n",
        v: h.v
      };
      a[q] = s;
      if (h.z) {
        a[q].z = h.z;
      }
      if (r) {
        a[q].s = r;
      }
    });
    if (c["!merges"]) {
      a["!merges"] = c["!merges"].map(function (f) {
        function g(h) {
          if (d >= 0 && h >= d) {
            return h + 1;
          } else {
            return h;
          }
        }
        return {
          s: {
            r: f.s.r,
            c: g(f.s.c)
          },
          e: {
            r: f.e.r,
            c: g(f.e.c)
          }
        };
      });
    }
    return a;
  }
  function onDownload() {
    var a = qs("#selFormat").value;
    var dlMsgEl = qs("#dlMsg");
    if (S.preset === "orig") {
      var b = buildOriginalWithZip(qs("#optWithResult").checked, qs("#optWithClean").checked, qs("#optWithOffice").checked);
      writeWorkbook(b.aoa, S.sheet || "Sheet1", a, baseName() + "_우편번호", {
        styled: true,
        marks: b.marks,
        zipCol: b.zipCol,
        extraFrom: b.extraFrom,
        widthFrom: Math.max(0, S.headerIdx),
        overlay: function (u) {
          return overlayOriginalCells(u, b);
        }
      });
      addLog("내려받기", b.aoa.length - (S.headerIdx >= 0 ? 1 : 0), "원본+우편번호 · " + baseName() + "_우편번호." + a);
      return setMsg(dlMsgEl, "내려받았습니다: " + baseName() + "_우편번호." + a + " (유사는 노랑·주황, 실패는 빨강으로 표시)", "ok");
    }
    var c = currentPreset();
    if (!c.cols.length) {
      return setMsg(dlMsgEl, "열 구성이 비어 있습니다. 「열 추가」 또는 「양식 파일에서 불러오기」로 열을 먼저 만들어 주세요.", "warn");
    }
    var d = c.sender || c.cols.some(function (c) {
      return /^sender/.test(c.src);
    });
    var g = buildPresetRows(c);
    var W = g.warn;
    var ST = g.st;
    if (d) {
      var f = readSenderForm();
      var h = f.name && f.zip && f.addr1;
      if ((ST.fixed || 0) > 0 && !h) {
        return setMsg(dlMsgEl, "고정 보내는 분을 쓰는 행이 " + fmtNum(ST.fixed) + "건입니다. 「보내는 분」의 이름·우편번호·주소를 먼저 채우거나, 「보내는 분 정하기」를 바꿔 주세요.", "warn");
      }
      if (h) {
        var p = qs("#sdKeep") && qs("#sdKeep").checked;
        settings.set({
          sender: p ? {
            name: f.name,
            zip: f.zip,
            addr1: f.addr1,
            addr2: f.addr2,
            tel: f.tel,
            line: qs("#sdLine") ? qs("#sdLine").value : ""
          } : null
        });
      }
    }
    if (c.sender) {
      settings.set({
        epostOpts: {
          mode: optValue("sdMode", ""),
          fb: optValue("sdFb", "self"),
          fillTel: optChecked("optFillTel", true),
          qty: optChecked("optQty", true),
          splitItem: optChecked("optSplitItem", true),
          splitSender: optChecked("optSplitSender", false)
        }
      });
    }
    if (!g.rows.length) {
      return setMsg(dlMsgEl, "내려받을 행이 없습니다." + (W.empty ? " 주소가 빈 행 " + fmtNum(W.empty) + "건(" + rowListText(W.emptyRows, W.empty) + ")은 뺐습니다." : "") + (W.skipped ? " 우편번호 없는 " + fmtNum(W.skipped) + "건은 뺐습니다." : ""), "warn");
    }
    var q = S.preset === "epost" ? "_우체국쇼핑" : S.preset === "biz" ? "_계약소포" : "_" + (clean(qs("#cName") && qs("#cName").value) || "양식");
    var r = !c.custom || qs("#cHead").checked;
    var s = c.split || 0;
    var byItem = !!c.sender && S.cols.item >= 0 && optChecked("optSplitItem", true);
    var bySender = !!c.sender && optChecked("optSplitSender", false);
    var groups = [];
    var gmap = {};
    var sidx = {};
    var scount = 0;
    g.rows.forEach(function (r, k) {
      var m = g.meta[k] || {};
      var it = byItem ? m.item || "" : "";
      var sk = bySender ? m.skey || "" : "";
      if (bySender && !sidx.hasOwnProperty(sk)) {
        sidx[sk] = ++scount;
      }
      var key = it + "\u0001" + sk;
      if (!gmap.hasOwnProperty(key)) {
        gmap[key] = groups.length;
        groups.push({
          item: it,
          sno: bySender ? sidx[sk] : 0,
          rows: []
        });
      }
      groups[gmap[key]].rows.push(r);
    });
    var itemsN = byItem ? Object.keys(groups.reduce(function (a, g) {
      a[g.item] = 1;
      return a;
    }, {})).length : 0;
    var files = [];
    var over = false;
    groups.forEach(function (g) {
      var tag = "";
      if (byItem && itemsN > 1) {
        tag += "_" + (safeFileName(g.item || "상품없음").slice(0, 20) || "상품");
      }
      if (bySender && scount > 1) {
        tag += "_주문자" + (g.sno < 10 ? "0" : "") + g.sno;
      }
      var step = s || g.rows.length;
      var parts = Math.ceil(g.rows.length / step);
      if (parts > 1) {
        over = true;
      }
      for (var p = 0; p < parts; p++) {
        files.push({
          rows: g.rows.slice(p * step, (p + 1) * step),
          name: baseName() + q + tag + (parts > 1 ? "_" + (p + 1) : "")
        });
      }
    });
    files.forEach(function (f, k) {
      setTimeout(function () {
        writeWorkbook((r ? [g.head] : []).concat(f.rows), c.sheet, a, f.name);
      }, k * 450);
    });
    addLog("내려받기", g.rows.length, c.name + " · " + files[0].name + "." + a + (files.length > 1 ? " 외 " + (files.length - 1) + "개" : ""));
    var why = [over ? (s || "") + "건씩" : "", byItem && itemsN > 1 ? "상품별" : "", bySender && scount > 1 ? "주문자별" : ""].filter(Boolean).join("·");
    var t = [fmtNum(g.rows.length) + "건을 " + (files.length > 1 ? files.length + "개 파일로" + (why ? "(" + why + " 나눔) " : " ") : "") + "내려받았습니다."];
    if (W.qtyAdded) {
      t.push("수량을 반영해 " + fmtNum(W.qtyAdded) + "줄을 늘렸습니다.");
    }
    if (W.self) {
      t.push("받는 분 칸이 빈 " + fmtNum(W.self) + "건은 보내는 분 주소로 본인 수령 처리했습니다.");
    }
    if (c.sender) {
      var sx = [ST.file ? "파일의 주문자 " + fmtNum(ST.file) + "건" : "", ST.self ? "받는 분과 같게 " + fmtNum(ST.self) + "건" : "", ST.fixed ? "고정값 " + fmtNum(ST.fixed) + "건" : ""].filter(Boolean);
      if (sx.length) {
        t.push("보내는 분: " + sx.join(" · ") + ".");
      }
    }
    if (ST.telFilled) {
      t.push("받는 분 전화가 없는 " + fmtNum(ST.telFilled) + "건은 보내는 분 전화로 채웠습니다.");
    }
    if (W.noTel) {
      t.push("받는 분 전화가 없는 행 " + fmtNum(W.noTel) + "건(" + rowListText(W.noTelRows, W.noTel) + ").");
    }
    if (W.sBad) {
      t.push("보내는 분 우편번호를 못 찾은 행 " + fmtNum(W.sBad) + "건(" + rowListText(W.sBadRows, W.sBad) + ") · 원본의 보내는 분 주소를 확인하세요.");
    }
    if (W.empty) {
      t.push("주소가 비어 뺀 행 " + fmtNum(W.empty) + "건(" + rowListText(W.emptyRows, W.empty) + ").");
    }
    if (W.skipped) {
      t.push("우편번호 없는 " + fmtNum(W.skipped) + "건은 뺐습니다(점검표에서 확인).");
    } else if (W.nozip) {
      t.push("우편번호 없는 행이 " + fmtNum(W.nozip) + "건 들어 있습니다.");
    }
    if (W.longName) {
      t.push("수취인명이 15자를 넘는 행 " + fmtNum(W.longName) + "건(" + rowListText(W.longRows, W.longName) + ").");
    }
    if (W.longSender) {
      t.push("발송인명이 16자를 넘는 행이 " + fmtNum(W.longSender) + "건 있습니다.");
    }
    if (files.length > 1) {
      t.push("브라우저가 여러 파일 내려받기를 물으면 「허용」을 누르세요.");
    }
    setMsg(dlMsgEl, t.join(" "), W.nozip || W.longName || W.noTel || W.sBad || W.empty || W.longSender ? "warn" : "ok");
  }
  function suggestCandidates(f) {
    if (f.status === "정확" && !f.changed) {
      return "";
    }
    try {
      var list = S.engine.search(f.addr, 3) || [];
      return list.slice(0, 3).map(function (c) {
        return (c.zip || "") + " · " + clean([c.addr1 || c.addr || c.text || "", c.range || ""].filter(Boolean).join(" "));
      }).join(" / ");
    } catch (err) {
      return "";
    }
  }
  function downloadReport() {
    var a = S.rows.filter(function (row) {
      return row.status !== "정확" || row.changed;
    });
    if (!a.length) {
      return setMsg(qs("#dlMsg"), "점검할 행이 없습니다. 모두 정확히 찾았습니다.", "ok");
    }
    var b = [["원본 행", "받는 분", "원본 주소", "기존 우편번호", "입력된 우편번호", "배달 우체국", "검색결과", "근거", "정제 주소", "추천 후보(우편번호 · 구간, 최대 3개)"]];
    var c = ["head"];
    a.forEach(function (f) {
      b.push([String(f.i + 1), S.cols.name >= 0 ? clean(S.aoa[f.i][S.cols.name]) : "", [f.addr, f.detail].filter(Boolean).join(" "), f.old, f.zip, deliveryOffice(f.zip), f.edited ? "수정" : f.status + (f.conf ? "·" + f.conf : ""), f.note, f.status === "실패" ? "" : [f.r.addr1, f.r.addr2].filter(Boolean).join(" "), suggestCandidates(f)]);
      c.push(f.edited ? "edit" : f.status === "정확" ? "" : f.status === "유사" ? f.conf === "하" ? "sim2" : "sim" : "fail");
    });
    var d = {
      styled: true,
      marks: c,
      zipCol: 4,
      extraFrom: 6
    };
    writeWorkbook(b, "점검표", "xlsx", baseName() + "_점검표", d);
    addLog("점검표 내려받기", a.length, baseName() + "_점검표.xlsx");
    setMsg(qs("#dlMsg"), "점검표를 내려받았습니다: 유사·실패·번호가 바뀐 " + fmtNum(a.length) + "건", "ok");
  }
  function copyTable() {
    var a;
    if (S.preset === "orig") {
      a = buildOriginalWithZip(qs("#optWithResult").checked, qs("#optWithClean").checked, qs("#optWithOffice").checked).aoa;
    } else {
      var b = currentPreset();
      if (!b.cols.length) {
        return setMsg(qs("#dlMsg"), "열 구성이 비어 있습니다.", "warn");
      }
      a = buildPresetRows(b).rows;
    }
    var c = a.map(function (g) {
      return g.map(function (h) {
        return safeCell(String(h == null ? "" : h).replace(/[\t\r\n]+/g, " "));
      }).join("\t");
    }).join("\r\n");
    addLog("표 복사", a.length, "클립보드");
    function d() {
      setMsg(qs("#dlMsg"), fmtNum(a.length) + "행을 복사했습니다. 공식 양식 파일의 첫 자료 칸에 붙여 넣으세요" + (S.preset === "orig" ? "." : " (제목 줄 제외)") + " 클립보드에 개인정보가 남으니 붙여 넣은 뒤에는 다른 것을 한 번 복사해 두세요.", "ok");
    }
    function f() {
      var g = document.createElement("textarea");
      g.value = c;
      document.body.appendChild(g);
      g.select();
      try {
        document.execCommand("copy");
        d();
      } catch (err) {
        setMsg(qs("#dlMsg"), "복사하지 못했습니다. 내려받기를 이용해 주세요.", "err");
      }
      g.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(c).then(d, f);
    } else {
      f();
    }
  }
  function renderPresets() {
    var presetsEl = qs("#presets");
    presetsEl.innerHTML = "";
    Object.keys(PRESETS).forEach(function (d) {
      var f = PRESETS[d];
      var g = document.createElement("button");
      g.type = "button";
      g.className = "preset" + (S.preset === d ? " on" : "");
      g.innerHTML = "<b>" + escHtml(f.name) + "</b><span>" + escHtml(f.desc) + "</span>";
      g.onclick = function () {
        S.preset = d;
        renderPresets();
      };
      presetsEl.appendChild(g);
    });
    var a = PRESETS[S.preset];
    var selFormatEl = qs("#selFormat");
    selFormatEl.innerHTML = a.formats.map(function (d) {
      return "<option value=\"" + d + "\">" + d + "</option>";
    }).join("");
    var presetOptsEl = qs("#presetOpts");
    presetOptsEl.innerHTML = "";
    setMsg(qs("#dlMsg"), "");
    if (S.preset === "orig") {
      presetOptsEl.innerHTML = "<label class=\"chk\"><input type=\"checkbox\" id=\"optWithResult\" checked> 검색결과·근거 열 붙이기</label><label class=\"chk\" style=\"margin-top:6px\"><input type=\"checkbox\" id=\"optWithClean\"> 정제 주소 열 붙이기</label><label class=\"chk\" style=\"margin-top:6px\"><input type=\"checkbox\" id=\"optWithOffice\"> 배달 우체국 열 붙이기</label><p class=\"hint\" style=\"margin:8px 0 0\">" + (S.cols.zip >= 0 ? "기존 우편번호 열(" + colLetter(S.cols.zip) + "열)에 채웁니다." : "주소 열 바로 앞에 「우편번호」 열을 새로 넣습니다.") + "</p>";
    } else {
      var b = "";
      var c = a.sender || a.custom && (S.customCols || []).some(function (d) {
        return /^sender/.test(d.src);
      });
      if (S.preset === "epost") {
        b += epostOptionsHtml();
      }
      if (c) {
        b += senderFormHtml();
      }
      if (S.preset === "epost") {
        b += "<p class=\"hint\" style=\"margin:10px 0 0\">주소1은 도로명+건물번호(지번 주소는 읍·면·동)까지, 주소2는 나머지입니다. 나머지가 없으면 점(.)을 넣고, 금지 특수문자는 지웁니다. 전화는 휴대전화가 있으면 휴대전화 칸에만 넣습니다.</p>";
      }
      if (S.preset === "biz") {
        b += "<p class=\"hint\" style=\"margin:0\">지침서의 제공 파일구조(박스단위·상품명·수취인명·우편번호·주소·전화번호) 순서입니다. 시스템에 등록해 둔 파일구조가 다르면 「사용자 지정 양식」으로 맞추세요. 상품명 열이 없으면 아래 기본값이 들어갑니다.</p><div class=\"grid2\" style=\"margin-top:10px\"><div class=\"field\"><label for=\"bizItem\">상품명 기본값</label><input type=\"text\" id=\"bizItem\" value=\"" + escHtml(settings.get().bizItem || "") + "\" placeholder=\"예) 정읍 특산품\"></div></div>";
      }
      if (a.custom) {
        b += customToolbarHtml();
      }
      presetOptsEl.innerHTML = b;
      if (c) {
        bindSenderForm();
      }
      if (S.preset === "epost" && qs("#sdMode")) {
        qs("#sdMode").onchange = function () {
          var fb = qs("#sdFb");
          if (fb) {
            fb.disabled = this.value !== "file";
          }
        };
      }
      if (S.preset === "biz") {
        var bizItemEl = qs("#bizItem");
        function d() {
          PRESETS.biz.cols[1].def = clean(bizItemEl.value);
          var f = {
            bizItem: bizItemEl.value
          };
          settings.set(f);
        }
        bizItemEl.oninput = d;
        d();
      }
      if (a.custom) {
        bindCustomEditor();
      }
    }
  }
  function epostOptionsHtml() {
    var o = settings.get().epostOpts || {};
    var hasS = hasSenderCols();
    var C = S.cols;
    var mode = o.mode === "self" || o.mode === "fixed" || o.mode === "file" && hasS ? o.mode : hasS ? "file" : "fixed";
    if (hasS && o.mode !== "self") {
      mode = "file";
    }
    function sel(v, c) {
      if (v === c) {
        return " selected";
      } else {
        return "";
      }
    }
    var h = "<div class=\"sub-h\">복수배송지 만들기</div><div class=\"grid2\"><div class=\"field\"><label for=\"sdMode\">보내는 분 정하기</label><select id=\"sdMode\">" + "<option value=\"file\"" + sel("file", mode) + (hasS ? "" : " disabled") + ">파일의 보내는 분(주문자) 열 · 행마다 따로</option>" + "<option value=\"self\"" + sel("self", mode) + ">받는 분과 같게 · 본인 수령</option>" + "<option value=\"fixed\"" + sel("fixed", mode) + ">모든 행 같은 보내는 분 · 아래 입력값</option></select>" + (hasS ? "<small class=\"fmsg\">보내는 분 열: " + escHtml([C.sName >= 0 ? "이름 " + colLetter(C.sName) : "", C.sAddr >= 0 ? "주소 " + colLetter(C.sAddr) : "", C.sZip >= 0 ? "우편번호 " + colLetter(C.sZip) : ""].filter(Boolean).join(" · ")) + "열</small>" : "<small class=\"fmsg\">주소록에 보내는 분(주문자) 열이 없습니다. 있으면 「열 확인」에서 지정하세요.</small>") + "</div><div class=\"field\"><label for=\"sdFb\">보내는 분 칸이 빈 행</label><select id=\"sdFb\"" + (mode === "file" ? "" : " disabled") + ">" + "<option value=\"self\"" + sel("self", o.fb || "self") + ">받는 분과 같게(본인 수령)</option>" + "<option value=\"fixed\"" + sel("fixed", o.fb) + ">아래 고정 보내는 분</option></select></div></div>";
    h += "<label class=\"chk\" style=\"margin-top:10px\"><input type=\"checkbox\" id=\"optFillTel\"" + (o.fillTel === false ? "" : " checked") + "> 받는 분 전화가 없으면 보내는 분 전화로 채우기</label>";
    if (C.qty >= 0) {
      h += "<label class=\"chk\" style=\"margin-top:6px\"><input type=\"checkbox\" id=\"optQty\"" + (o.qty === false ? "" : " checked") + "> 수량(" + colLetter(C.qty) + "열)만큼 줄 늘리기 · 1줄 = 1개</label>";
    }
    if (C.item >= 0) {
      h += "<label class=\"chk\" style=\"margin-top:6px\"><input type=\"checkbox\" id=\"optSplitItem\"" + (o.splitItem === false ? "" : " checked") + "> 상품명(" + colLetter(C.item) + "열)이 다르면 파일 나누기 · 복수배송지 주문은 상품마다 따로 합니다</label>";
    }
    h += "<label class=\"chk\" style=\"margin-top:6px\"><input type=\"checkbox\" id=\"optSplitSender\"" + (o.splitSender ? " checked" : "") + "> 보내는 분(주문자)별로 파일 나누기 · 결제·취소를 주문자마다 따로 할 때</label>";
    h += "<p class=\"hint\" style=\"margin:8px 0 14px\">300건이 넘으면 300건씩 자동으로 나눕니다(우체국쇼핑 한 번 업로드 한도). 아래 「보내는 분」 입력값은 「모든 행 같은 보내는 분」이나 빈 행 대체로 쓸 때만 필요합니다.</p>";
    return h;
  }
  function senderFormHtml() {
    var a = settings.get().sender || {};
    return "<div class=\"sub-h\">보내는 분</div><label class=\"chk\" style=\"margin-bottom:8px\"><input type=\"checkbox\" id=\"sdKeep\"" + (a.name ? " checked" : "") + "> 이 PC에 기억해 두기 <small style=\"color:var(--ink2)\">(끄면 창을 닫을 때 사라집니다(개인정보 저장 최소화)</small></label><div class=\"grid2\"><div class=\"field\"><label for=\"sdName\">이름 <small>16자 이내</small></label><input type=\"text\" id=\"sdName\" maxlength=\"16\" value=\"" + escHtml(a.name || "") + "\"></div><div class=\"field\"><label for=\"sdTel\">전화</label><input type=\"text\" id=\"sdTel\" value=\"" + escHtml(a.tel || "") + "\" placeholder=\"010-0000-0000\"></div><div class=\"field\" style=\"grid-column:1/-1\"><label for=\"sdLine\">주소 <small>한 줄로 적으면 아래 칸을 자동으로 채웁니다</small></label><input type=\"text\" id=\"sdLine\" value=\"" + escHtml(a.line || "") + "\" placeholder=\"예) 전북특별자치도 정읍시 조곡천1길 27 정읍우체국\"></div><div class=\"field\"><label for=\"sdZip\">우편번호</label><input type=\"text\" id=\"sdZip\" maxlength=\"5\" value=\"" + escHtml(a.zip || "") + "\"></div><div class=\"field\"><label for=\"sdAddr1\">주소1</label><input type=\"text\" id=\"sdAddr1\" value=\"" + escHtml(a.addr1 || "") + "\"></div><div class=\"field\"><label for=\"sdAddr2\">주소2(나머지)</label><input type=\"text\" id=\"sdAddr2\" value=\"" + escHtml(a.addr2 || "") + "\"></div></div>";
  }
  function bindSenderForm() {
    qs("#sdLine").onchange = function () {
      var a = S.engine.lookup(this.value, regionOpts());
      if (a.grade === "실패") {
        return;
      }
      qs("#sdZip").value = a.zip;
      qs("#sdAddr1").value = a.addr1;
      qs("#sdAddr2").value = a.addr2 || ".";
    };
  }
  function sourceOptionsHtml(a) {
    var b = CUSTOM_SOURCES.map(function (c) {
      return "<option value=\"" + c[0] + "\"" + (c[0] === a ? " selected" : "") + ">" + escHtml(c[1]) + "</option>";
    }).join("");
    b += "<optgroup label=\"원본 열 그대로\">";
    for (var i = 0; i < S.ncol; i++) {
      b += "<option value=\"orig:" + i + "\"" + ("orig:" + i === a ? " selected" : "") + ">" + escHtml(colOptionLabel(i)) + "</option>";
    }
    return b + "</optgroup>";
  }
  function customToolbarHtml() {
    var a = settings.get().customs || {};
    var b = Object.keys(a);
    return "<div class=\"tools\"><button type=\"button\" class=\"btn sm\" id=\"cImport\">양식 파일에서 불러오기</button><input type=\"file\" id=\"cFile\" accept=\".xlsx,.xls,.csv,.cell\" hidden><button type=\"button\" class=\"btn sm ghost\" id=\"cAdd\">+ 열 추가</button>" + (b.length ? "<select id=\"cLoad\" class=\"mini\" style=\"width:auto\"><option value=\"\">저장한 양식 불러오기…</option>" + b.map(function (c) {
      return "<option>" + escHtml(c) + "</option>";
    }).join("") + "</select>" : "") + "<span class=\"grow\"></span><input type=\"text\" id=\"cName\" class=\"mini\" style=\"width:160px\" placeholder=\"양식 이름\" value=\"" + escHtml(S.customName || "") + "\"><button type=\"button\" class=\"btn sm ghost\" id=\"cSave\">이 구성 저장</button>" + (b.length ? "<button type=\"button\" class=\"btn sm ghost\" id=\"cDel\">삭제</button>" : "") + "</div><label class=\"chk\" style=\"margin:10px 0\"><input type=\"checkbox\" id=\"cHead\" checked> 첫 줄에 제목 줄 넣기</label><div class=\"clist\" id=\"cList\"></div><p class=\"hint\" style=\"margin:10px 0 0\">포스트넷 창구접수·간편사전접수처럼 열 순서가 정해진 양식은, 그 양식 파일을 「양식 파일에서 불러오기」로 넣으면 제목 줄을 읽어 열을 자동으로 맞춥니다. 맞춤 결과는 꼭 한 번 확인하세요.</p>";
  }
  function renderCustomCols() {
    var cListEl = qs("#cList");
    if (!cListEl) {
      return;
    }
    cListEl.innerHTML = "";
    (S.customCols || []).forEach(function (a, idx) {
      var b = document.createElement("div");
      b.className = "crow";
      b.innerHTML = "<span class=\"idx\">" + colLetter(idx) + "</span><input type=\"text\" class=\"mini ch\" value=\"" + escHtml(a.h) + "\" placeholder=\"제목\" aria-label=\"" + colLetter(idx) + "열 제목\"><select class=\"mini cs\" aria-label=\"" + colLetter(idx) + "열 내용\">" + sourceOptionsHtml(a.src) + "</select><input type=\"text\" class=\"mini cd\" value=\"" + escHtml(a.def || "") + "\" placeholder=\"기본값\" aria-label=\"" + colLetter(idx) + "열 기본값\"><span><button type=\"button\" class=\"btn sm ghost mini cu\" title=\"위로\">↑</button><button type=\"button\" class=\"btn sm ghost mini cx\" title=\"지우기\">×</button></span>";
      qs(".ch", b).oninput = function () {
        a.h = this.value;
      };
      qs(".cs", b).onchange = function () {
        var c = /^sender/.test(a.src);
        a.src = this.value;
        if (c !== /^sender/.test(a.src)) {
          renderPresets();
        }
      };
      qs(".cd", b).oninput = function () {
        a.def = this.value;
      };
      qs(".cu", b).onclick = function () {
        if (idx > 0) {
          var c = S.customCols[idx - 1];
          S.customCols[idx - 1] = a;
          S.customCols[idx] = c;
          renderCustomCols();
        }
      };
      qs(".cx", b).onclick = function () {
        S.customCols.splice(idx, 1);
        renderCustomCols();
      };
      cListEl.appendChild(b);
    });
  }
  function customColumns() {
    return (S.customCols || []).map(function (a) {
      var b = {
        h: a.h,
        src: a.src,
        def: a.def || ""
      };
      return b;
    });
  }
  function guessTemplateSource(a, b) {
    var c = clean(a).replace(/\s+/g, "");
    var d = /발송|보내는|송하인|주문자|신청인/.test(c);
    var f = b.some(function (h) {
      return /상세|나머지|주소2/.test(clean(h).replace(/\s+/g, ""));
    });
    var g = b.some(function (h) {
      return /휴대|핸드폰|이동통신|모바일/.test(clean(h));
    });
    if (/우편번호|우편|zip|post/i.test(c)) {
      if (d) {
        return "senderZip";
      } else {
        return "zip";
      }
    }
    if (/상세|나머지|주소2/.test(c)) {
      if (d) {
        return "senderAddr2";
      } else {
        return "addr2";
      }
    }
    if (/주소|소재지|배송지|addr/i.test(c)) {
      if (d) {
        if (f) {
          return "senderAddr1";
        } else {
          return "senderAddrFull";
        }
      } else if (f) {
        return "addr1";
      } else {
        return "addrFull";
      }
    }
    if (/휴대|핸드폰|이동통신|모바일|mobile/i.test(c)) {
      if (d) {
        return "senderPhone";
      } else {
        return "mobile";
      }
    }
    if (/전화|연락처|tel|phone/i.test(c)) {
      if (d) {
        return "senderPhone";
      } else if (g) {
        return "tel";
      } else {
        return "phone";
      }
    }
    if (/성명|이름|수취인|받는|수령|고객명|상호|name/i.test(c) || /^(발송인|보내는분|보내는사람|송하인|주문자|주문인|신청인)명?$/.test(c) || /^(수신자|수신인|대상자|민원인|납세자|세대주)(명|성명|이름)?$/.test(c)) {
      if (d) {
        return "senderName";
      } else {
        return "name";
      }
    }
    if (/상품|품명|내용품|물품/.test(c)) {
      return "item";
    }
    if (/메시지|메세지|메모|요청|비고/.test(c)) {
      return "memo";
    }
    if (/순번|연번|^번호$|^no\.?$/i.test(c)) {
      return "seq";
    }
    if (/박스|수량|개수|통수/.test(c)) {
      return "const";
    }
    return "blank";
  }
  function bindCustomEditor() {
    if (!S.customCols) {
      S.customCols = [];
    }
    renderCustomCols();
    qs("#cAdd").onclick = function () {
      S.customCols.push({
        h: "",
        src: "blank",
        def: ""
      });
      renderCustomCols();
    };
    qs("#cImport").onclick = function () {
      qs("#cFile").click();
    };
    qs("#cFile").onchange = function () {
      var a = this.files[0];
      if (!a) {
        return;
      }
      readFileSafely(a).then(function (b) {
        var c = sheetToRows(b.Sheets[b.SheetNames[0]]);
        var d = findHeaderRow(c);
        if (d < 0) {
          d = c.findIndex(function (g) {
            return g.some(function (h) {
              return clean(h);
            });
          });
        }
        if (d < 0) {
          throw new Error("empty");
        }
        var f = c[d].map(function (g) {
          if (g == null) {
            return "";
          } else {
            return String(g).trim();
          }
        });
        while (f.length && !f[f.length - 1]) {
          f.pop();
        }
        S.customCols = f.map(function (g) {
          var h = guessTemplateSource(g, f);
          var p = {
            h: g,
            src: h,
            def: h === "const" ? "1" : ""
          };
          return p;
        });
        S.customName = a.name.replace(/\.[^.]+$/, "");
        PRESETS.custom.sheet = b.SheetNames[0] || "Sheet1";
        renderPresets();
        setMsg(qs("#dlMsg"), "양식의 제목 줄 " + f.length + "칸을 읽어 열을 맞췄습니다. 각 열의 내용이 맞는지 확인해 주세요.", "ok");
      }).catch(function () {
        setMsg(qs("#dlMsg"), "양식 파일을 읽지 못했습니다.", "err");
      });
      this.value = "";
    };
    qs("#cSave").onclick = function () {
      var a = clean(qs("#cName").value);
      if (!a) {
        return setMsg(qs("#dlMsg"), "양식 이름을 적어 주세요.", "warn");
      }
      var b = settings.get().customs || {};
      b[a] = {
        cols: customColumns(),
        sheet: PRESETS.custom.sheet
      };
      var c = {
        customs: b
      };
      settings.set(c);
      S.customName = a;
      renderPresets();
      setMsg(qs("#dlMsg"), "「" + a + "」 양식을 이 PC에 저장했습니다.", "ok");
    };
    var cLoadEl = qs("#cLoad");
    if (cLoadEl) {
      cLoadEl.onchange = function () {
        var a = (settings.get().customs || {})[this.value];
        if (!a) {
          return;
        }
        S.customCols = a.cols.map(function (b) {
          var c = {
            h: b.h,
            src: b.src,
            def: b.def
          };
          return c;
        });
        S.customName = this.value;
        PRESETS.custom.sheet = a.sheet || "Sheet1";
        renderPresets();
      };
    }
    var cDelEl = qs("#cDel");
    if (cDelEl) {
      cDelEl.onclick = function () {
        var a = clean(qs("#cName").value);
        var b = settings.get().customs || {};
        if (!b[a]) {
          return setMsg(qs("#dlMsg"), "저장된 양식 이름을 「양식 이름」 칸에 적어 주세요.", "warn");
        }
        delete b[a];
        var c = {
          customs: b
        };
        settings.set(c);
        S.customName = "";
        renderPresets();
      };
    }
  }
  function openFindDialog(a) {
    S.searchFor = a || null;
    var findDlgEl = qs("#findDlg");
    qs("#findQ").value = a ? [a.addr, a.detail].filter(Boolean).join(" ") : "";
    qs("#findHint").textContent = a ? a.i + 1 + "행에 넣을 우편번호를 고르세요. 목록에서 누르면 그 줄에 바로 들어갑니다." : "도로명·건물번호나 동·리 이름을 넣으면 해당 구간의 우편번호를 보여 줍니다. 예) 정읍시 충정로 146";
    qs("#findList").innerHTML = "";
    qs("#findBest").innerHTML = "";
    if (findDlgEl.showModal) {
      findDlgEl.showModal();
    } else {
      findDlgEl.setAttribute("open", "");
    }
    qs("#findQ").focus();
    qs("#findQ").select();
    if (a) {
      runFind();
    }
  }
  function runFind() {
    var a = clean(qs("#findQ").value);
    var b = regionOpts();
    if (!a) {
      qs("#findBest").innerHTML = "";
      qs("#findList").innerHTML = "";
      return;
    }
    var c = S.engine.lookup(a, b);
    qs("#findBest").innerHTML = c.grade === "실패" ? "<div class=\"fb none\">이 글자로는 주소를 찾지 못했습니다. 도로명이나 동·리 이름만 남기고 다시 찾아 보세요.</div>" : "<div class=\"fb\"><b class=\"z\">" + escHtml(c.zip) + "</b><span class=\"a\">" + escHtml([c.addr1, c.addr2].filter(Boolean).join(" ")) + "</span><span class=\"m\">" + escHtml(c.grade + (c.conf ? "·" + c.conf : "")) + (deliveryOffice(c.zip) ? " · " + escHtml(deliveryOffice(c.zip)) : "") + "</span><button type=\"button\" class=\"btn sm primary\" data-zip=\"" + escHtml(c.zip) + "\">이 번호 쓰기</button></div>";
    var d = S.engine.search(a, 80);
    qs("#findList").innerHTML = d.length ? d.map(function (f) {
      return "<button type=\"button\" class=\"frow\" data-zip=\"" + escHtml(f.zip) + "\"><b>" + escHtml(f.zip) + "</b><span class=\"a\">" + escHtml(f.addr) + "</span><span class=\"r\">" + escHtml(f.range) + "</span><span class=\"o\">" + escHtml(deliveryOffice(f.zip)) + "</span></button>";
    }).join("") : "<p class=\"hint\">DB에서 같은 이름의 구간을 찾지 못했습니다.</p>";
  }
  function pickFindResult(a) {
    var b = S.searchFor;
    if (!b) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(a).catch(function () {});
      }
      qs("#findHint").textContent = a + " 를 복사했습니다.";
      return;
    }
    b.zip = a;
    b.edited = true;
    b.changed = !!b.old && b.old !== a;
    b.note = "주소 찾기에서 고름" + (isKnownZip(a) ? "" : " · DB에 없는 번호");
    var findDlgEl = qs("#findDlg");
    if (findDlgEl.close) {
      findDlgEl.close();
    } else {
      findDlgEl.removeAttribute("open");
    }
    renderSummary();
    renderTable(true);
    setMsg(qs("#dlMsg"), b.i + 1 + "행 우편번호를 " + a + "(으)로 바꿨습니다.", "ok");
  }
  var LABEL_SIZES = [["1x6", "6매 (1열×6행)", 1, 6], ["2x6", "12매 (2열×6행)", 2, 6], ["2x7", "14매 (2열×7행)", 2, 7], ["2x8", "16매 (2열×8행)", 2, 8], ["2x9", "18매 (2열×9행)", 2, 9], ["3x6", "18매 (3열×6행)", 3, 6], ["3x7", "21매 (3열×7행)", 3, 7], ["3x8", "24매 (3열×8행)", 3, 8], ["3x9", "27매 (3열×9행)", 3, 9]];
  function openLabelDialog() {
    var labelDlgEl = qs("#labelDlg");
    var a = settings.get().label || {};
    qs("#lbKind").innerHTML = LABEL_SIZES.map(function (b) {
      return "<option value=\"" + b[0] + "\"" + (a.kind === b[0] ? " selected" : "") + ">" + b[1] + "</option>";
    }).join("");
    if (!a.kind) {
      qs("#lbKind").value = "2x8";
    }
    qs("#lbTitle").value = a.title == null ? "귀하" : a.title;
    qs("#lbSize").value = a.size || "11";
    qs("#lbTel").checked = !!a.tel;
    qs("#lbSender").checked = !!a.sender;
    if (labelDlgEl.showModal) {
      labelDlgEl.showModal();
    } else {
      labelDlgEl.setAttribute("open", "");
    }
    renderLabels();
  }
  function labelTargetRows() {
    var a = qs("#chkSkipFail") && qs("#chkSkipFail").checked;
    return S.rows.filter(function (row) {
      return (row.addr || row.detail) && (!a || !!row.zip);
    });
  }
  function renderLabels() {
    var a = qs("#lbKind").value;
    var b = LABEL_SIZES.filter(function (p1) {
      return p1[0] === a;
    })[0] || LABEL_SIZES[3];
    var c = b[2];
    var d = b[3];
    var f = c * d;
    var g = clean(qs("#lbTitle").value);
    var h = Number(qs("#lbSize").value) || 11;
    var p = qs("#lbTel").checked;
    var q = qs("#lbSender").checked;
    var r = readSenderForm();
    var s = {
      kind: a,
      title: g,
      size: h,
      tel: p,
      sender: q
    };
    var t = {
      label: s
    };
    settings.set(t);
    var u = {
      sender: r,
      seq: 0
    };
    var v = labelTargetRows();
    var w = "";
    var x = u;
    var y = 198 / c;
    var z = 277 / d;
    for (var i = 0; i < v.length; i += f) {
      w += "<div class=\"sheet\" style=\"--cols:" + c + ";--lw:" + y.toFixed(2) + "mm;--lh:" + z.toFixed(2) + "mm;--fs:" + h + "pt\">";
      for (var j = i; j < Math.min(i + f, v.length); j++) {
        var a1 = v[j];
        x.seq = j + 1;
        var b1 = fieldValue(a1, "name", {}, x);
        var c1 = fieldValue(a1, "phone", {}, x);
        var d1 = a1.status !== "실패" && a1.r.addr1;
        var f1 = d1 ? [a1.r.addr1, a1.r.addr2].filter(Boolean).join(" ") : [a1.addr, a1.detail].filter(Boolean).join(" ");
        var g1 = privacyMask.on && !S.labelPeek;
        var h1 = a1.s && (a1.s.name || a1.s.addr) ? {
          name: a1.s.name || "",
          zip: a1.s.zip || "",
          addr1: a1.s.r && a1.s.status !== "실패" ? a1.s.r.addr1 : a1.s.addr,
          addr2: a1.s.r && a1.s.status !== "실패" ? a1.s.r.addr2 : a1.s.detail
        } : r;
        w += "<div class=\"label\">" + (q && h1.name ? "<div class=\"from\">" + escHtml([h1.zip, h1.addr1, h1.addr2].filter(Boolean).join(" ")) + " " + escHtml(h1.name) + " 보냄</div>" : "") + "<div class=\"zip\">" + escHtml(a1.zip || "") + "</div><div class=\"addr\"><span class=\"pv\">" + escHtml(g1 ? maskAddr(f1) : f1) + "</span><span class=\"pr\">" + escHtml(f1) + "</span></div><div class=\"to\"><span class=\"pv\">" + escHtml(g1 ? maskName(b1) : b1) + "</span><span class=\"pr\">" + escHtml(b1) + "</span>" + (b1 && g ? " <em>" + escHtml(g) + "</em>" : "") + (p && c1 ? "<span class=\"tel\"><span class=\"pv\">" + escHtml(g1 ? maskTel(c1) : c1) + "</span><span class=\"pr\">" + escHtml(c1) + "</span></span>" : "") + "</div></div>";
      }
      w += "</div>";
    }
    qs("#labelArea").innerHTML = w || "<p class=\"hint\" style=\"padding:20px\">인쇄할 줄이 없습니다.</p>";
    qs("#lbInfo").textContent = fmtNum(v.length) + "건 · A4 " + Math.ceil(v.length / f) + "장";
    var btnLabelPeekEl = qs("#btnLabelPeek");
    if (btnLabelPeekEl) {
      btnLabelPeekEl.hidden = !privacyMask.on;
      btnLabelPeekEl.textContent = S.labelPeek ? "다시 가리기" : "미리보기 잠깐 보기";
    }
  }
  var ZOOM_STEPS = [100, 115, 130, 150, 175];
  function setZoom(a) {
    a = ZOOM_STEPS.indexOf(a) >= 0 ? a : 115;
    S.zoom = a;
    document.documentElement.style.zoom = a === 100 ? "" : a / 100;
    var zoomNowEl = qs("#zoomNow");
    if (zoomNowEl) {
      zoomNowEl.textContent = a + "%";
    }
    var b = ZOOM_STEPS.indexOf(a);
    qs("#btnZoomOut").disabled = b <= 0;
    qs("#btnZoomIn").disabled = b >= ZOOM_STEPS.length - 1;
    var c = {
      zoom: a
    };
    settings.set(c);
  }
  function stepZoom(a) {
    var b = ZOOM_STEPS.indexOf(S.zoom || 115);
    setZoom(ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, b + a))]);
  }
  function openLogDialog() {
    var logDlgEl = qs("#logDlg");
    var a = loadLog().slice().reverse();
    qs("#logCount").textContent = a.length ? fmtNum(a.length) + "건 (" + a[a.length - 1].t.slice(0, 10) + " ~ " + a[0].t.slice(0, 10) + ")" : "기록 없음";
    qs("#logBody").innerHTML = a.length ? "<table class=\"logt\"><thead><tr><th>때</th><th>한 일</th><th class=\"n\">건수</th><th>메모</th></tr></thead><tbody>" + a.slice(0, 300).map(function (b) {
      return "<tr><td>" + escHtml(b.t) + "</td><td>" + escHtml(b.a) + "</td><td class=\"n\">" + (b.n ? fmtNum(b.n) : "") + "</td><td>" + escHtml(b.m) + "</td></tr>";
    }).join("") + "</tbody></table>" + (a.length > 300 ? "<p class=\"hint\">최근 300건만 보여 줍니다. 전체는 내보내기로 확인하세요.</p>" : "") : "<p class=\"hint\">아직 기록이 없습니다.</p>";
    if (logDlgEl.showModal) {
      logDlgEl.showModal();
    } else {
      logDlgEl.setAttribute("open", "");
    }
  }
  function downloadLog() {
    var a = loadLog();
    if (!a.length) {
      return;
    }
    var b = [["때", "한 일", "건수", "메모"]].concat(a.map(function (c) {
      return [c.t, c.a, c.n ? String(c.n) : "", c.m];
    }));
    writeWorkbook(b, "처리이력", "xlsx", "우편번호검색기_처리이력_" + todayYmd(), {
      styled: true,
      marks: ["head"].concat(a.map(function () {
        return "";
      }))
    });
    addLog("이력 내보내기", a.length, "");
  }
  function wipeAll(a) {
    if (!a && !window.confirm("화면에 올린 주소록과 검색 결과를 지웁니다.\n이 PC에 저장해 둔 보내는 분 정보도 함께 지웁니다.\n(우편번호 DB·처리 이력·저장한 양식은 남습니다)\n\n지울까요?")) {
      return;
    }
    var b = S.rows.length;
    S.wb = null;
    S.aoa = [];
    S.rows = [];
    S.fileName = "";
    S.headerIdx = -1;
    S.headerAuto = "";
    S.shown = 0;
    S.searchFor = null;
    var c = {
      addr: [],
      addr2: -1,
      zip: -1,
      name: -1,
      tel: -1,
      mobile: -1,
      item: -1,
      memo: -1
    };
    S.cols = c;
    privacyMask.reveal = {};
    ["#step2", "#step3", "#step4"].forEach(function (d) {
      qs(d).hidden = true;
    });
    qs("#resultTable tbody").innerHTML = "";
    qs("#previewTable").innerHTML = "";
    qs("#labelArea").innerHTML = "";
    qs("#pasteBox").value = "";
    qs("#fileInput").value = "";
    qs("#fileLabel").textContent = "";
    setMsg(qs("#fileMsg"), "");
    setMsg(qs("#dlMsg"), "");
    try {
      settings.set({
        sender: null
      });
    } catch (err) {}
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(" ").catch(function () {});
    }
    addLog("자료 지움", b, "끝내고 지우기");
    if (!a) {
      setMsg(qs("#fileMsg"), "화면의 주소록과 저장된 보내는 분 정보를 지웠습니다. 내려받은 파일은 이 프로그램이 지울 수 없으니, 다 쓴 파일은 직접 파기해 주세요.", "ok");
    }
  }
  function probeUrl(a) {
    return new Promise(function (b) {
      var c = false;
      var d = setTimeout(function () {
        if (!c) {
          c = true;
          b(false);
        }
      }, 2500);
      function f(g) {
        if (!c) {
          c = true;
          clearTimeout(d);
          b(g);
        }
      }
      try {
        fetch(a + (a.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now(), {
          mode: "no-cors",
          cache: "no-store"
        }).then(function () {
          f(true);
        }, function () {
          f(false);
        });
      } catch (err) {
        f(false);
      }
    });
  }
  function checkSites() {
    if (navigator.onLine === false) {
      return Promise.resolve({
        epost: false,
        law: false
      });
    }
    return Promise.all([probeUrl(EPOST_DB_URL), probeUrl(LAW_NOTICE_URL)]).then(function (a) {
      var b = {
        epost: a[0],
        law: a[1]
      };
      return b;
    });
  }
  function dbUpdateNotice() {
    var a = S.engine ? dateLabel(S.engine.date) : "";
    return ["[우편번호 DB 최신화 안내]", "현재 이 PC의 우편번호 DB 기준일: " + a + " (" + (dbAgeDays() || 0) + "일 지남)", "※ 아래 세 가지 자료는 모두 같습니다. 편한 방법 하나만 쓰시면 됩니다.", "", "■ 방법 1: 국가법령정보센터에서 받기 (내부망에서도 열립니다)", " 1. " + LAW_NOTICE_URL, "    (국가법령정보센터 ▸ 행정규칙 ▸ 현행행정규칙 ▸ 「도로명주소 연계 우편번호 조정 고시」)", " 2. 고시 본문 아래쪽의 <별표 5 - 참고자료(도로명주소 및 지번주소 범위자료, 사서함)>를 눌러 내려받습니다.", " 3. 우편번호 자동검색기에서 「DB 최신화 ▸ 별표 5 파일 고르기」로 그 압축파일을 그대로(풀지 말고) 넣습니다.", "", "■ 방법 2: 매월 오는 고시 공문의 붙임 사용", " 1. 우정사업본부 고시 「도로명주소 연계 우편번호 조정 고시」 공문을 엽니다.", " 2. 붙임 가운데 <별표 5> 압축파일을 내려받아 위 3번과 같이 넣습니다.", "    ※ 별표 1~4는 지역별(건물 단위) 주소 자료로, 이 프로그램에서는 쓰지 않습니다.", "", "■ 방법 3: 외부망 PC에서 인터넷우체국 파일 받아 오기", " 1. " + EPOST_DB_URL, " 2. 「범위주소 DB」(areacd_rangeaddr_DB.zip)와 「사서함주소 DB」(areacd_pobox_DB.zip)를 받습니다.", " 3. USB 등으로 옮긴 뒤 같은 방법으로 넣습니다.", "", "※ 교체한 DB는 이 PC의 브라우저에 저장되어 다음에도 그대로 쓰입니다."].join("\n");
  }
  function openUpdateDialog(a) {
    var updDlgEl = qs("#updDlg");
    var b = dbAgeDays();
    qs("#updNow").textContent = (S.engine ? dateLabel(S.engine.date) : "-") + " 기준" + (b == null ? "" : " · " + (b <= 0 ? "오늘" : b + "일 지남"));
    qs("#updNow").className = "big " + (b != null && b >= warnDays() ? "bad" : b != null && b >= 35 ? "warn" : "good");
    qs("#updWarn").value = String(warnDays());
    qs("#updUrl").value = settings.get().dbUrl || "";
    qs("#updAuto").hidden = !a;
    qs("#updMsg").hidden = true;
    qs("#updOnline").hidden = true;
    qs("#updOffline").hidden = false;
    qs("#updNet").innerHTML = "<span class=\"dot\"></span> 이 프로그램은 스스로 밖으로 연결하지 않습니다. 인터넷우체국에서 바로 받으려면 아래 단추를 누르세요. <button type=\"button\" class=\"btn sm\" id=\"btnUpdProbe\">인터넷 연결 확인</button>";
    qs("#btnUpdProbe").onclick = checkNetwork;
    if (updDlgEl.showModal) {
      updDlgEl.showModal();
    } else {
      updDlgEl.setAttribute("open", "");
    }
    if (settings.get().autoProbe) {
      checkNetwork();
    }
  }
  function checkNetwork() {
    qs("#updNet").innerHTML = "<span class=\"dot\"></span> 연결을 확인하는 중…";
    addLog("연결 확인", 0, "epost.go.kr · law.go.kr 접속 가능 여부만 확인");
    checkSites().then(function (a) {
      S.online = a;
      var b;
      if (a.epost) {
        b = "<span class=\"dot on\"></span> 인터넷에 연결되어 있습니다(외부망). 아래 어느 방법이든 됩니다.";
      } else if (a.law) {
        b = "<span class=\"dot on\"></span> 인터넷우체국은 닿지 않지만 <b>법령정보센터는 열립니다</b>. 방법 ①로 바로 받으실 수 있습니다.";
      } else {
        b = "<span class=\"dot err\"></span> 바깥으로 닿지 않습니다. 매월 오는 고시 공문의 붙임(방법 ②)을 쓰시거나, 아래 안내문을 복사해 외부망 PC에서 받아 오세요.";
      }
      qs("#updNet").innerHTML = b;
      qs("#updOnline").hidden = !a.epost;
    });
  }
  function downloadDbOnline() {
    var a = clean(qs("#updUrl").value);
    if (!/^https:\/\/([a-z0-9-]+\.)*(epost|koreapost|law)\.go\.kr\//i.test(a)) {
      return setUpdMsg("인터넷우체국(epost.go.kr)이나 국가법령정보센터(law.go.kr) 주소만 넣을 수 있습니다. 이 프로그램은 그 밖의 곳에는 접속하지 않도록 막아 두었습니다.", "warn");
    }
    var b = {
      dbUrl: a
    };
    settings.set(b);
    setUpdMsg("내려받는 중…", "");
    setBusy(true, "인터넷우체국에서 DB를 받는 중…", 0.2);
    fetch(a, {
      cache: "no-store"
    }).then(function (c) {
      if (!c.ok) {
        throw new Error("서버가 " + c.status + " 로 답했습니다.");
      }
      return c.arrayBuffer();
    }).then(function (c) {
      return buildDbFromFiles([{
        name: a.split("/").pop() || "db.zip",
        get: function () {
          return Promise.resolve(c);
        }
      }]);
    }).catch(function (c) {
      setBusy(false);
      var d = !c || !c.message || /Failed to fetch|NetworkError|CORS/i.test(c.message);
      setUpdMsg(d ? "브라우저 보안 규칙 때문에 이 파일을 곧바로 받아올 수 없습니다. 아래 「받으러 가기」로 파일을 내려받은 뒤, 그 압축파일을 이 창에 끌어다 놓거나 「DB 파일 고르기」로 넣어 주세요." : "받지 못했습니다: " + c.message, "warn");
    });
  }
  function setUpdMsg(a, b) {
    var updMsgEl = qs("#updMsg");
    updMsgEl.hidden = !a;
    updMsgEl.className = "msg" + (b ? " " + b : "");
    updMsgEl.textContent = a;
  }
  function remindDbUpdate() {
    if (S.privacyPending || /(^|[#&])kiosk\b/.test(location.hash)) {
      return;
    }
    var a = dbAgeDays();
    if (a == null || a < warnDays()) {
      return;
    }
    var b = settings.get();
    if (b.snooze === todayYmd()) {
      return;
    }
    openUpdateDialog(true);
  }
  function init() {
    var a = settings.get();
    if (a.region) {
      qs("#optRegion").value = a.region;
    }
    if (a.zipPolicy) {
      qs("#optZipPolicy").value = a.zipPolicy;
    }
    privacyMask.on = a.mask !== false;
    setZoom(a.zoom || 115);
    qs("#btnZoomIn").onclick = function () {
      stepZoom(1);
    };
    qs("#btnZoomOut").onclick = function () {
      stepZoom(-1);
    };
    window.addEventListener("keydown", function (b) {
      if (!b.ctrlKey && !b.metaKey) {
        return;
      }
      if (b.key === "=" || b.key === "+") {
        b.preventDefault();
        stepZoom(1);
      } else if (b.key === "-" || b.key === "_") {
        b.preventDefault();
        stepZoom(-1);
      } else if (b.key === "0") {
        b.preventDefault();
        setZoom(100);
      }
    });
    if (!a.seenPrivacy) {
      var privacyDlgEl = qs("#privacyDlg");
      S.privacyPending = true;
      setTimeout(function () {
        if (privacyDlgEl.showModal) {
          privacyDlgEl.showModal();
        } else {
          privacyDlgEl.setAttribute("open", "");
        }
      }, 500);
      qs("#btnPrivacyOk").onclick = function () {
        settings.set({
          seenPrivacy: 1
        });
        S.privacyPending = false;
        if (privacyDlgEl.close) {
          privacyDlgEl.close();
        } else {
          privacyDlgEl.removeAttribute("open");
        }
        setTimeout(remindDbUpdate, 300);
      };
    }
    qsa(".tab").forEach(function (b) {
      b.onclick = function () {
        qsa(".tab").forEach(function (c) {
          c.classList.toggle("on", c === b);
        });
        qs("#tab-file").hidden = b.dataset.tab !== "file";
        qs("#tab-paste").hidden = b.dataset.tab !== "paste";
      };
    });
    var dropEl = qs("#drop");
    ["dragenter", "dragover"].forEach(function (b) {
      dropEl.addEventListener(b, function (c) {
        c.preventDefault();
        dropEl.classList.add("over");
      });
    });
    ["dragleave", "drop"].forEach(function (b) {
      dropEl.addEventListener(b, function (c) {
        c.preventDefault();
        dropEl.classList.remove("over");
      });
    });
    dropEl.addEventListener("drop", function (b) {
      var c = b.dataTransfer.files[0];
      if (c) {
        readInputFile(c);
      }
    });
    window.addEventListener("dragover", function (b) {
      b.preventDefault();
    });
    window.addEventListener("drop", function (b) {
      b.preventDefault();
      if (b.target.closest && (b.target.closest("#drop") || b.target.closest("dialog"))) {
        return;
      }
      var c = b.dataTransfer && b.dataTransfer.files[0];
      if (!c) {
        return;
      }
      if (/\.zip$/i.test(c.name) || /areacd|rangeaddr|pobox|별표/i.test(c.name)) {
        importDbFiles(b.dataTransfer.files).catch(function () {});
      } else {
        readInputFile(c);
      }
    });
    dropEl.addEventListener("keydown", function (b) {
      if (b.key === "Enter" || b.key === " ") {
        b.preventDefault();
        qs("#fileInput").click();
      }
    });
    qs("#fileInput").onchange = function () {
      if (this.files[0]) {
        readInputFile(this.files[0]);
      }
      this.value = "";
    };
    qs("#btnPaste").onclick = function () {
      loadPastedText(qs("#pasteBox").value);
    };
    qs("#selSheet").onchange = function () {
      if (S.wb) {
        loadWorkbook(this.value);
      }
    };
    qs("#selHeader").onchange = function () {
      S.headerIdx = Number(this.value);
      detectColumns();
      qs("#fileLabel").textContent = S.fileName + " · " + fmtNum(S.aoa.length - (S.headerIdx + 1)) + "행";
      renderColMap();
      renderPreview();
    };
    qs("#optRegion").oninput = paintRegionMsg;
    qs("#optRegion").onchange = function () {
      if (S.aoa.length && !S.cols.addr.length) {
        detectColumns();
        renderColMap();
        renderPreview();
      }
    };
    qs("#btnRun").onclick = runSearch;
    qs("#btnMore").onclick = function () {
      renderTable(false);
    };
    qs("#btnDownload").onclick = onDownload;
    qs("#btnReport").onclick = downloadReport;
    qs("#btnCopy").onclick = copyTable;
    qs("#btnHelp").onclick = function () {
      var helpDlgEl = qs("#helpDlg");
      if (helpDlgEl.showModal) {
        helpDlgEl.showModal();
      } else {
        helpDlgEl.setAttribute("open", "");
      }
    };
    var btnAboutEl = qs("#btnAbout");
    if (btnAboutEl) {
      btnAboutEl.onclick = function () {
        var aboutDbEl = qs("#aboutDb");
        if (aboutDbEl) {
          aboutDbEl.textContent = S.engine ? dateLabel(S.engine.date) + " 기준 · 구간 " + fmtNum(S.engine.db && S.engine.db.stats ? S.engine.db.stats.road + S.engine.db.stats.jibun + S.engine.db.stats.pobox : 0) + "건" : "여는 중";
        }
        var aboutDlgEl = qs("#aboutDlg");
        if (aboutDlgEl.showModal) {
          aboutDlgEl.showModal();
        } else {
          aboutDlgEl.setAttribute("open", "");
        }
      };
    }
    qsa("[data-close]").forEach(function (b) {
      b.onclick = function () {
        var c = b.closest("dialog");
        if (c.close) {
          c.close();
        } else {
          c.removeAttribute("open");
        }
      };
    });
    qs("#btnDbUpdate").onclick = function () {
      openUpdateDialog(false);
    };
    qs("#dbFiles").onchange = function () {
      if (this.files.length) {
        importDbFiles(this.files).catch(function () {});
      }
      this.value = "";
    };
    qs("#btnFind").onclick = function () {
      openFindDialog(null);
    };
    qs("#findQ").addEventListener("keydown", function (b) {
      if (b.key === "Enter") {
        b.preventDefault();
        runFind();
      }
    });
    qs("#btnFindGo").onclick = runFind;
    qs("#findDlg").addEventListener("click", function (b) {
      var c = b.target.closest ? b.target.closest("[data-zip]") : null;
      if (c) {
        pickFindResult(c.dataset.zip);
      }
    });
    qs("#btnLabel").onclick = openLabelDialog;
    ["#lbKind", "#lbTitle", "#lbSize", "#lbTel", "#lbSender"].forEach(function (b) {
      var c = qs(b);
      c.onchange = renderLabels;
      if (c.tagName === "INPUT" && c.type === "text") {
        c.oninput = renderLabels;
      }
    });
    qs("#btnLabelPrint").onclick = function () {
      addLog("라벨 인쇄", labelTargetRows().length, qs("#lbKind").value);
      window.print();
    };
    qs("#btnLabelPeek").onclick = function () {
      S.labelPeek = !S.labelPeek;
      if (S.labelPeek) {
        addLog("가림 해제", labelTargetRows().length, "라벨 미리보기");
      }
      renderLabels();
    };
    qs("#btnUpdPick").onclick = qs("#btnUpdPick2").onclick = function () {
      qs("#dbFiles").click();
    };
    qs("#btnUpdOpen").onclick = function () {
      window.open(EPOST_DB_URL, "_blank", "noopener");
      setUpdMsg("새 탭에서 「범위주소 DB」와 「사서함주소 DB」를 받은 뒤, 그 압축파일을 이 창에 끌어다 놓으세요.", "ok");
    };
    qs("#btnUpdLaw").onclick = function () {
      window.open(LAW_NOTICE_URL, "_blank", "noopener");
      addLog("법령정보센터 열기", 0, "");
      setUpdMsg("새 탭에 현행 고시가 열립니다. 본문 아래쪽 「별표 5 참고자료(도로명주소 및 지번주소 범위자료, 사서함)」를 내려받아 이 창에 끌어다 놓으세요.", "ok");
    };
    qs("#btnUpdFetch").onclick = downloadDbOnline;
    qs("#btnUpdCopy").onclick = function () {
      var b = dbUpdateNotice();
      function c() {
        setUpdMsg("안내문을 복사했습니다. 메모장이나 메일에 붙여 넣어 외부망 PC로 옮기세요.", "ok");
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(b).then(c, function () {
          qs("#updGuide").hidden = false;
          qs("#updGuide").value = b;
          qs("#updGuide").select();
        });
      } else {
        qs("#updGuide").hidden = false;
        qs("#updGuide").value = b;
        qs("#updGuide").select();
      }
    };
    qs("#updWarn").onchange = function () {
      settings.set({
        warnDays: Number(this.value)
      });
      if (S.engine) {
        showDbInfo(S.engine.db, S.dbSource);
      }
    };
    qs("#btnUpdSnooze").onclick = function () {
      settings.set({
        snooze: todayYmd()
      });
      var updDlgEl = qs("#updDlg");
      if (updDlgEl.close) {
        updDlgEl.close();
      } else {
        updDlgEl.removeAttribute("open");
      }
    };
    ["dragover", "drop"].forEach(function (b) {
      qs("#updDlg").addEventListener(b, function (c) {
        c.preventDefault();
        c.stopPropagation();
        if (b === "drop" && c.dataTransfer.files.length) {
          importDbFiles(c.dataTransfer.files).catch(function () {});
        }
      });
    });
    qs("#resultTable").addEventListener("click", function (b) {
      var c = b.target;
      if (!c.classList) {
        return;
      }
      var d = c.closest("tr");
      if (!d) {
        return;
      }
      var f = Number(d.dataset.i);
      if (c.classList.contains("eye")) {
        return revealRow(f);
      }
      if (!c.classList.contains("findbtn")) {
        return;
      }
      var g = S.rows.filter(function (row) {
        return row.i === f;
      })[0];
      if (g) {
        openFindDialog(g);
      }
    });
    qsa("#resultTable thead th[data-sort]").forEach(function (b) {
      b.onclick = function () {
        toggleSort(b.dataset.sort);
      };
    });
    qs("#btnSummary").onclick = function () {
      var b = countGrades();
      var c = dateLabel(todayYmd());
      var d = "[우편번호 검색 결과] " + (S.fileName || "직접 입력") + " · " + c + "\n전체 " + fmtNum(b.all) + "건 / 정확 " + fmtNum(b.ok) + " · 유사 " + fmtNum(b.s1 + b.s2 + b.s3) + "(상 " + fmtNum(b.s1) + "·중 " + fmtNum(b.s2) + "·하 " + fmtNum(b.s3) + ") · 실패 " + fmtNum(b.fail) + "\n우편번호 없음 " + fmtNum(b.nozip) + "건 / 기존 번호와 다름 " + fmtNum(b.changed) + "건 · 우편번호 DB " + dateLabel(S.engine.date) + " 기준\n· " + APP_CREDIT;
      function f() {
        setMsg(qs("#dlMsg"), "결과 요약을 복사했습니다. 보고나 메모에 붙여 넣으세요.", "ok");
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(d).then(f, function () {
          setMsg(qs("#dlMsg"), d, "ok");
        });
      } else {
        setMsg(qs("#dlMsg"), d, "ok");
      }
    };
    qs("#btnLog").onclick = openLogDialog;
    qs("#btnLogExport").onclick = downloadLog;
    qs("#btnLogClear").onclick = function () {
      if (window.confirm("처리 이력을 지웁니다. 사고가 났을 때 소명 자료로 쓸 수 있으니, 필요하면 먼저 내보내 두세요.\n\n지울까요?")) {
        clearLog();
        openLogDialog();
      }
    };
    qs("#btnWipe").onclick = function () {
      wipeAll(false);
    };
    qs("#optAutoProbe").checked = !!settings.get().autoProbe;
    qs("#optAutoProbe").onchange = function () {
      var b = {
        autoProbe: this.checked
      };
      settings.set(b);
    };
    qs("#resultTable").addEventListener("keydown", function (b) {
      if (b.key !== "Enter" || !b.target.classList || !b.target.classList.contains("zipin")) {
        return;
      }
      b.preventDefault();
      var c = qsa("#resultTable .zipin");
      var d = c.indexOf(b.target);
      b.target.blur();
      var f = c[d + 1];
      if (f) {
        f.focus();
        f.select();
      }
    });
    qs("#resultTable").addEventListener("change", function (b) {
      var c = b.target;
      if (!c.classList || !c.classList.contains("zipin")) {
        return;
      }
      var d = c.closest("tr");
      if (!d) {
        return;
      }
      var f = Number(d.dataset.i);
      var g = S.rows.filter(function (row) {
        return row.i === f;
      })[0];
      if (!g) {
        return;
      }
      var h = c.value.replace(/[^\d]/g, "").slice(0, 5);
      c.value = h;
      if (h && !/^\d{5}$/.test(h)) {
        c.classList.add("edited");
        return setMsg(qs("#dlMsg"), f + 1 + "행: 우편번호는 숫자 5자리여야 합니다.", "warn");
      }
      if (h === g.zip) {
        return;
      }
      g.zip = h;
      g.edited = true;
      g.changed = !!g.old && !!h && g.old !== h;
      g.note = "직접 수정" + (h && !isKnownZip(h) ? " · DB에 없는 번호" : "") + " · " + g.r.note;
      c.classList.add("edited");
      var p = d.children;
      p[3].innerHTML = gradeBadge(g);
      p[4].textContent = g.note;
      renderSummary();
    });
    dropEl.addEventListener("drop", function (b) {
      var c = b.dataTransfer.files[0];
      if (c && (/\.zip$/i.test(c.name) || /areacd|rangeaddr|pobox|별표/i.test(c.name))) {
        b.stopImmediatePropagation();
        importDbFiles(b.dataTransfer.files).catch(function () {});
      }
    }, true);
    setBusy(true, "우편번호 DB를 여는 중…", 0.3);
    setTimeout(function () {
      loadDb().then(function () {
        setBusy(false);
        setTimeout(remindDbUpdate, 400);
        if (window.__onReady) {
          window.__onReady();
        }
      }).catch(function (b) {
        setBusy(false);
        qs("#dbDot").className = "dot err";
        qs("#dbInfo").textContent = "우편번호 DB를 열지 못했습니다";
        setMsg(qs("#fileMsg"), "DB를 여는 데 실패했습니다: " + (b && b.message ? b.message : b) + " · 엣지·크롬 최신 버전에서 다시 열어 주세요.", "err");
      });
    }, 30);
  }
  window.__zip = {
    S: S,
    app: APP,
    checkDbAge: function () {
      return remindDbUpdate();
    },
    dbAgeDays: function () {
      return dbAgeDays();
    },
    log: function (a, b, c) {
      try {
        return addLog(a, b, c);
      } catch (err) {}
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();