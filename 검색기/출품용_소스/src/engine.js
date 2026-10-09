/*! 우편번호 자동검색기 v1.4 (출품본) — 주소 판정 엔진 | (c) 2026 이희재 · 정읍우체국 | 2026 공공 AI 대전환 챌린지 출품본 — 대회 규정에 따른 사용권 부여 */
(function (a, b) {
  if (typeof module === "object" && module.exports) {
    module.exports = b();
  } else {
    a.ZipEngine = b();
  }
})(typeof self !== "undefined" ? self : this, function () {
  'use strict';

  var hasOwn = Object.prototype.hasOwnProperty;
  var SIDO_ALIASES = [[["서울특별시", "서울시", "서울"], ["서울특별시"]], [["부산광역시", "부산직할시", "부산시", "부산"], ["부산광역시"]], [["대구광역시", "대구직할시", "대구시", "대구"], ["대구광역시"]], [["인천광역시", "인천직할시", "인천시", "인천"], ["인천광역시"]], [["광주광역시", "광주직할시", "광주"], ["광주광역시", "전남광주통합특별시"]], [["대전광역시", "대전직할시", "대전시", "대전"], ["대전광역시"]], [["울산광역시", "울산시", "울산"], ["울산광역시"]], [["세종특별자치시", "세종자치시", "세종시", "세종"], ["세종특별자치시"]], [["경기도", "경기"], ["경기도"]], [["강원특별자치도", "강원자치도", "강원도", "강원"], ["강원특별자치도", "강원도"]], [["충청북도", "충북도", "충북"], ["충청북도"]], [["충청남도", "충남도", "충남"], ["충청남도"]], [["전북특별자치도", "전북자치도", "전라북도", "전북도", "전북"], ["전북특별자치도", "전라북도"]], [["전남광주통합특별시", "전남광주특별시", "광주전남통합특별시", "전남광주통합시", "전남광주", "광주전남"], ["전남광주통합특별시"]], [["전라남도", "전남도", "전남"], ["전라남도", "전남광주통합특별시"]], [["경상북도", "경북도", "경북"], ["경상북도"]], [["경상남도", "경남도", "경남"], ["경상남도"]], [["제주특별자치도", "제주자치도", "제주도", "제주"], ["제주특별자치도"]]];
  function pad5(a) {
    a = String(a);
    while (a.length < 5) {
      a = "0" + a;
    }
    return a;
  }
  function toStr(a) {
    try {
      if (a == null) {
        return "";
      } else {
        return String(a);
      }
    } catch (err) {
      return "";
    }
  }
  function normText(a) {
    var b = toStr(a);
    if (b.normalize) {
      b = b.normalize("NFKC");
    }
    return b.replace(/\s+/g, "").replace(/\([^)]*\)/g, "").replace(/[·.\u318d\u119e\u30fb\u2022\u2027\u2219\u22c5]/g, "").replace(/[a-z]/g, function (c) {
      return c.toUpperCase();
    });
  }
  function editDistance(a, b, c) {
    var d = a.length;
    var f = b.length;
    if (Math.abs(d - f) > c) {
      return c + 1;
    }
    var g = null;
    var h = new Array(f + 1);
    var p;
    var q;
    var r;
    for (r = 0; r <= f; r++) {
      h[r] = r;
    }
    for (q = 1; q <= d; q++) {
      p = new Array(f + 1);
      p[0] = q;
      var s = p[0];
      for (r = 1; r <= f; r++) {
        var t = a.charCodeAt(q - 1) === b.charCodeAt(r - 1) ? 0 : 1;
        var u = Math.min(h[r] + 1, p[r - 1] + 1, h[r - 1] + t);
        if (g && q > 1 && r > 1 && a.charCodeAt(q - 1) === b.charCodeAt(r - 2) && a.charCodeAt(q - 2) === b.charCodeAt(r - 1)) {
          u = Math.min(u, g[r - 2] + 1);
        }
        p[r] = u;
        if (u < s) {
          s = u;
        }
      }
      if (s > c) {
        return c + 1;
      }
      g = h;
      h = p;
    }
    return h[f];
  }
  function ZipEngine(a, b) {
    this.db = a;
    this.date = a.date || "";
    this._strict = true;
    var c = this;
    var d;
    this.sidoAlias = new Map();
    this.maxSidoLen = 0;
    a.sido.forEach(function (y, idx) {
      c._addSidoAlias(y, idx);
    });
    SIDO_ALIASES.forEach(function (y) {
      var z = -1;
      for (var j = 0; j < y[1].length && z < 0; j++) {
        z = a.sido.indexOf(y[1][j]);
      }
      if (z < 0) {
        return;
      }
      y[0].forEach(function (a1) {
        if (!c.sidoAlias.has(a1)) {
          c._addSidoAlias(a1, z);
        }
      });
    });
    this.sggOfSido = a.sido.map(function () {
      return [];
    });
    this.sggNames = new Map();
    this.sggStems = new Map();
    this.maxSggLen = 0;
    function f(y, z, a1) {
      if (!z) {
        return;
      }
      var b1 = y.get(z);
      if (!b1) {
        y.set(z, b1 = []);
      }
      if (b1.indexOf(a1) < 0) {
        b1.push(a1);
      }
      if (z.length > c.maxSggLen) {
        c.maxSggLen = z.length;
      }
    }
    a.sgg.forEach(function (y, idx) {
      c.sggOfSido[y[0]].push(idx);
      var z = y[1];
      if (!z) {
        return;
      }
      var a1 = z.split(" ");
      f(c.sggNames, a1.join(""), idx);
      a1.forEach(function (b1) {
        f(c.sggNames, b1, idx);
        if (b1.length >= 3) {
          f(c.sggStems, b1.slice(0, -1), idx);
        }
      });
      if (a1.length > 1) {
        f(c.sggStems, a1.map(function (b1) {
          if (b1.length >= 3) {
            return b1.slice(0, -1);
          } else {
            return b1;
          }
        }).join(""), idx);
      }
    });
    this.emdSet = [];
    this.riMap = [];
    this.maxEmdLen = 0;
    this.maxRiLen = 0;
    this.maxRoadLen = 0;
    for (d = 0; d < a.sgg.length; d++) {
      var g = new Set();
      var h = new Map();
      var p = a.jibun[d];
      for (var q in p) {
        if (!hasOwn.call(p, q)) {
          continue;
        }
        var r = q.indexOf("|");
        var s = q.slice(0, r);
        var t = q.slice(r + 1);
        g.add(s);
        if (s.length > this.maxEmdLen) {
          this.maxEmdLen = s.length;
        }
        if (t) {
          var u = h.get(t);
          if (!u) {
            h.set(t, u = []);
          }
          if (u.indexOf(s) < 0) {
            u.push(s);
          }
          if (t.length > this.maxRiLen) {
            this.maxRiLen = t.length;
          }
        }
      }
      var v = a.road[d];
      for (var w in v) {
        if (!hasOwn.call(v, w)) {
          continue;
        }
        if (w.length > this.maxRoadLen) {
          this.maxRoadLen = w.length;
        }
        var x = v[w];
        for (var i = 0; i < x.length; i += 8) {
          if (x[i]) {
            g.add(a.emd[x[i]]);
          }
        }
      }
      this.emdSet.push(g);
      this.riMap.push(h);
    }
    this._zipSet = null;
    this._sggZips = [];
    this.allSgg = a.sgg.map(function (y, idx) {
      return idx;
    });
    this._setExtra(b);
  }
  ZipEngine.prototype._setExtra = function (a) {
    var b = this;
    var c = this.db;
    this.extra = a || null;
    this.hjd = [];
    this.officeRuns = null;
    this.officeNames = null;
    this.bldKey = null;
    this._bld = null;
    if (!a) {
      return;
    }
    if (a.hjd) {
      var d = {};
      c.sgg.forEach(function (p, idx) {
        d[normText(c.sido[p[0]]) + "|" + normText(p[1])] = idx;
      });
      Object.keys(a.hjd).forEach(function (p) {
        var q = d[p];
        if (q === undefined) {
          return;
        }
        b.hjd[q] = a.hjd[p];
      });
    }
    if (a.bld && a.bld.sgg) {
      var f = {};
      c.sgg.forEach(function (p, idx) {
        f[normText(c.sido[p[0]]) + "|" + normText(p[1])] = idx;
      });
      this.bldKey = [];
      Object.keys(a.bld.sgg).forEach(function (p) {
        var q = f[normText(p.split("|")[0]) + "|" + normText(p.split("|")[1])];
        if (q !== undefined) {
          b.bldKey[q] = p;
        }
      });
      this._bld = [];
    }
    if (a.office && a.office.runs) {
      var g = [];
      var h = 0;
      a.office.runs.split(",").forEach(function (p) {
        var q = p.split(".");
        var r = h + parseInt(q[0], 36);
        var s = parseInt(q[1], 36);
        g.push([r, r + s - 1, parseInt(q[2], 36)]);
        h = r + s;
      });
      this.officeRuns = g;
      this.officeNames = a.office.names || [];
    }
  };
  ZipEngine.prototype.office = function (a) {
    var b = this.officeRuns;
    if (!b) {
      return "";
    }
    var c = parseInt(a, 10);
    if (!c && c !== 0) {
      return "";
    }
    var d = 0;
    var f = b.length - 1;
    while (d <= f) {
      var g = d + f >> 1;
      var h = b[g];
      if (c < h[0]) {
        f = g - 1;
      } else if (c > h[1]) {
        d = g + 1;
      } else {
        return this.officeNames[h[2]] || "";
      }
    }
    return "";
  };
  ZipEngine.prototype._bldOf = function (a) {
    if (!this.bldKey) {
      return null;
    }
    if (this._bld[a] !== undefined) {
      return this._bld[a];
    }
    var b = this.bldKey[a];
    var c = b && this.extra.bld.sgg[b];
    if (!c) {
      return this._bld[a] = null;
    }
    var d = this.extra.bld.names;
    var f = new Map();
    var g = 0;
    var h = 0;
    var p = c.r ? c.r.split(",") : [];
    for (var i = 0; i < p.length; i++) {
      var q = p[i].split(".");
      g += parseInt(q[0], 36);
      var r = d[g];
      if (!r) {
        continue;
      }
      var s = f.get(r);
      if (!s) {
        f.set(r, s = []);
      }
      s.push([c.e[parseInt(q[1], 36)] || "", c.z[parseInt(q[2], 36)] || ""]);
      if (r.length > h) {
        h = r.length;
      }
    }
    var t = [];
    f.forEach(function (u, idx) {
      var v = idx.match(/^(.{3,})(아파트|빌라|맨션|오피스텔|타운|빌딩|타워|연립|주택|APT)$/);
      if (v && !f.has(v[1])) {
        t.push([v[1], u]);
      }
    });
    t.forEach(function (u) {
      if (!f.has(u[0])) {
        f.set(u[0], u[1]);
      }
    });
    f.maxLen = Math.min(h, 24);
    return this._bld[a] = f;
  };
  ZipEngine.prototype.building = function (a, b) {
    var c = this._bldOf(a);
    return c && c.get(normText(b)) || [];
  };
  ZipEngine.prototype.legalDongs = function (a, b) {
    var c = this.hjd[a];
    return c && hasOwn.call(c, b) && c[b] || [];
  };
  ZipEngine.prototype._addSidoAlias = function (a, b) {
    this.sidoAlias.set(a, b);
    if (a.length > this.maxSidoLen) {
      this.maxSidoLen = a.length;
    }
  };
  ZipEngine.prototype.sggLabel = function (a) {
    var b = this.db.sgg[a];
    return (this.db.sido[b[0]] + " " + b[1]).trim();
  };
  ZipEngine.prototype.zipSet = function () {
    if (this._zipSet) {
      return this._zipSet;
    }
    var a = new Set();
    var b = this.db;
    var c;
    var d;
    var f;
    var g;
    for (c = 0; c < b.road.length; c++) {
      for (g in b.road[c]) {
        f = b.road[c][g];
        for (d = 7; d < f.length; d += 8) {
          a.add(f[d]);
        }
      }
      for (g in b.jibun[c]) {
        f = b.jibun[c][g];
        for (d = 5; d < f.length; d += 6) {
          a.add(f[d]);
        }
      }
    }
    b.pobox.forEach(function (h) {
      a.add(h[6]);
    });
    return this._zipSet = a;
  };
  ZipEngine.prototype.sggHasZip = function (a, b) {
    var c = this._sggZips[a];
    if (!c) {
      c = new Set();
      var d = this.db;
      var f;
      var g;
      var h;
      for (f in d.road[a]) {
        g = d.road[a][f];
        for (h = 7; h < g.length; h += 8) {
          c.add(g[h]);
        }
      }
      for (f in d.jibun[a]) {
        g = d.jibun[a][f];
        for (h = 5; h < g.length; h += 6) {
          c.add(g[h]);
        }
      }
      this._sggZips[a] = c;
    }
    return c.has(parseInt(b, 10));
  };
  function prepText(a) {
    var b = toStr(a);
    if (b.length > 400) {
      b = b.slice(0, 400);
    }
    var c = /(\d) ?[\u2010-\u2015\u2212\uff0d\u3161\u1173\u30fc\u2500\u4e00] ?(?=\d)/g;
    b = b.replace(c, "$1-");
    if (b.normalize) {
      b = b.normalize("NFKC");
    }
    b = b.replace(/[\u200b-\u200d\ufeff\u00a0\s]+/g, " ").trim();
    b = b.replace(c, "$1-").replace(/(\d) ?의 ?(?=\d)/g, "$1-");
    b = b.replace(/(^|[^\d,])(\d{1,2}),(\d{3})(?![\d,])/g, "$1$2$3");
    var d = "";
    var f = b.match(/^(?:우 ?편? ?번? ?호? ?[:)\]]? ?)?[(\[<]? ?(\d{5}|\d{3} ?- ?\d{3}) ?[)\]>]? ?(?=[가-힣])/);
    if (f) {
      d = f[1].replace(/\s/g, "");
      b = b.slice(f[0].length);
    }
    var g = b.match(/ ?(?:[(\[] ?(?:우 ?[:)]? ?)?(\d{5}|\d{3}-\d{3}) ?[)\]]|(?:우 ?편 ?번 ?호|우 ?[):]) ?[:)]? ?(\d{5}|\d{3}-\d{3}))$/);
    if (g) {
      if (!d) {
        d = g[1] || g[2];
      }
      b = b.slice(0, g.index);
    }
    var h = [];
    b = b.replace(/[(\[]([^()\[\]]*)[)\]]/g, function (v, w) {
      w = w.trim();
      if (/^(?:우 ?[:)]? ?)?(\d{5}|\d{3}-\d{3})$/.test(w)) {
        if (!d) {
          d = w.replace(/[^\d-]/g, "");
        }
        return " ";
      }
      if (w) {
        h.push(w);
      }
      return " ";
    });
    var p = b.search(/[(\[]/);
    if (p >= 0) {
      var q = b.slice(p + 1).trim();
      if (q) {
        h.push(q);
      }
      b = b.slice(0, p);
    }
    var r = false;
    b = b.replace(/[,，、;]/g, " ").replace(/(\d) ?~ ?\d+(?:-\d+)?/g, function (v, w) {
      r = true;
      return w;
    }).replace(/ +/g, " ").trim();
    b = b.replace(/(\d) ?[·.\u318d\u119e\u30fb\u2022\u2027\u2219\u22c5] ?(?=\d+ ?[가-힣])/g, "$1");
    var s = "";
    var t = [];
    for (var i = 0; i < b.length; i++) {
      var u = b.charAt(i);
      if (u !== " ") {
        s += u >= "a" && u <= "z" ? u.toUpperCase() : u;
        t.push(i);
      }
    }
    t.push(b.length);
    return {
      text: b,
      cs: s,
      map: t,
      zipFound: d,
      paren: h,
      glued: b.indexOf(" ") < 0,
      rangeMark: r
    };
  }
  function atBoundary(a, b) {
    if (b >= a.cs.length) {
      return true;
    }
    if (b === 0) {
      return true;
    }
    return a.map[b] - a.map[b - 1] > 1;
  }
  function nextBoundary(a, b) {
    var c = a.cs.length;
    for (var i = b + 1; i < c; i++) {
      if (atBoundary(a, i)) {
        return i;
      }
    }
    return c;
  }
  function restOf(a, b) {
    return a.text.slice(a.map[Math.min(b, a.cs.length)]);
  }
  function skipChars(a, b, c) {
    var d = a.text.substr(a.map[Math.min(b, a.cs.length)], c);
    return b + d.replace(/ /g, "").length;
  }
  function detailAfter(a, b) {
    var c = a.text.slice(a.map[Math.min(b, a.cs.length)]).trim();
    c = c.replace(/^[-.\s]+/, "").trim();
    if (a.paren.length) {
      c = (c ? c + " " : "") + "(" + a.paren.join(", ") + ")";
    }
    return c;
  }
  ZipEngine.prototype._endOk = function (a, b, c) {
    if (!this._strict || a.glued) {
      return true;
    }
    if (atBoundary(a, b)) {
      return true;
    }
    if (c === "sido" || c === "sgg") {
      return false;
    }
    var d = a.cs.substr(b, 4);
    if (/^\d/.test(d)) {
      return true;
    }
    if (c === "road" && /^(?:지하|B\d)/.test(d)) {
      return true;
    }
    if ((c === "emd" || c === "ri") && /^산\d/.test(d)) {
      return true;
    }
    return false;
  };
  ZipEngine.prototype._readNumber = function (a, b, c) {
    var d = restOf(a, b);
    var f = c === "road" ? /^ ?(지하층?|지하|B(?=\d))? ?(\d{1,5})(?!\d)/ : /^ ?(산)? ?(\d{1,5})(?!\d)/;
    var g = d.match(f);
    if (!g || g[2].charAt(0) === "0") {
      return null;
    }
    var h = g[0].length;
    var p = parseInt(g[2], 10);
    var q = 0;
    var r = false;
    var s = a.glued || !this._strict;
    function t(f1) {
      if (f1 === "" || f1.charAt(0) === " ") {
        return "ok";
      }
      if (/^(?:동|호|층|차|통|반)(?![가-힣])/.test(f1) || /^(?:단지|세기|빌딩|번길|번안길)/.test(f1)) {
        return "unit";
      }
      if (/^(?:외|및|일대|일원|부근)/.test(f1)) {
        return "ok";
      }
      if (/^[가-힣A-Za-z]/.test(f1)) {
        if (s && !/^[가-힣]?(?:길|로)(?:\d|$)/.test(f1)) {
          return "ok";
        } else {
          return "word";
        }
      }
      return "word";
    }
    var u = d.slice(h).match(/^ ?- ?(\d{1,5})(?!\d)/);
    if (u) {
      var v = d.slice(h + u[0].length);
      if (/^ ?- ?\d/.test(v)) {
        return null;
      }
      var w = t(v.replace(/^(?:번지|번(?!길)|호(?![가-힣\d]))/, ""));
      if (w === "ok") {
        q = parseInt(u[1], 10);
        h += u[0].length;
      } else if (w === "word") {
        return null;
      }
    } else if (t(d.slice(h).replace(/^ ?(?:번지|번(?!길))/, "")) !== "ok") {
      return null;
    }
    if (q) {
      var x = d.slice(h).match(/^호(?![가-힣\d])/);
      if (x) {
        h += x[0].length;
      }
    }
    var y = d.slice(h).match(c === "road" ? /^ ?(?:번지|번(?!길))/ : /^ ?(?:번지|번(?![가-힣]))/);
    if (y) {
      h += y[0].length;
      r = true;
      if (c === "jibun" && !q) {
        var z = d.slice(h).match(/^ ?(\d{1,4})호(?![가-힣\d])/);
        if (z && z[1].charAt(0) !== "0") {
          q = parseInt(z[1], 10);
          h += z[0].length;
        }
      }
    }
    var a1 = !!g[1];
    if (c === "road" && !a1) {
      var b1 = d.slice(h).match(/^ ?지하(?![가-힣])/);
      if (b1) {
        a1 = true;
        h += b1[0].length;
      }
    }
    var c1 = c === "jibun" && !r && q >= 101 && p >= 101 && p % 100 >= 1 && p % 100 <= 30 && q % 100 >= 1 && q % 100 <= 30;
    var d1 = {
      m: p,
      s: q,
      flag: a1,
      len: h,
      marker: r,
      aptLike: c1
    };
    return d1;
  };
  ZipEngine.prototype._matchSido = function (a, b) {
    var c = a.cs;
    for (var i = Math.min(this.maxSidoLen, c.length - b); i >= 2; i--) {
      var d = this.sidoAlias.get(c.substr(b, i));
      if (d === undefined) {
        continue;
      }
      if (this._endOk(a, b + i, "sido")) {
        return {
          sd: d,
          len: i
        };
      }
      if (c.charAt(b + i) === "시" && this._endOk(a, b + i + 1, "sido")) {
        return {
          sd: d,
          len: i + 1,
          plusSi: true
        };
      }
    }
    return null;
  };
  ZipEngine.prototype._matchSgg = function (a, b, c) {
    var d = a.cs;
    var f = this;
    function g(r) {
      if (c === null || c === undefined) {
        return r;
      }
      return r.filter(function (s) {
        return f.db.sgg[s][0] === c;
      });
    }
    var h = Math.min(this.maxSggLen, d.length - b);
    var p;
    var q;
    for (p = h; p >= 2; p--) {
      q = this.sggNames.get(d.substr(b, p));
      if (q && this._endOk(a, b + p, "sgg")) {
        q = g(q);
        if (q.length) {
          return {
            sggs: q,
            len: p
          };
        }
      }
    }
    for (p = h; p >= 2; p--) {
      if (!atBoundary(a, b + p) || a.glued) {
        continue;
      }
      q = this.sggStems.get(d.substr(b, p));
      if (q) {
        q = g(q);
        if (q.length) {
          return {
            sggs: q,
            len: p,
            stem: true
          };
        }
      }
    }
    return null;
  };
  ZipEngine.prototype._narrow = function (a, b, c, d) {
    for (var i = 0; i < 3; i++) {
      var f = false;
      if (a.glued && i > 0) {
        break;
      }
      var g = this._prefixRoad(a, b, d) || this._prefixEmd(a, b, d);
      var h = a.glued || g ? null : this._matchSido(a, b);
      if (h && (c === null || c === undefined || h.sd === c) && b + h.len < a.cs.length) {
        b += h.len;
        f = true;
      }
      var p = this._matchSgg(a, b, c);
      if (p && g && g.len >= p.len) {
        p = null;
      }
      if (p) {
        var q = p.sggs.filter(function (t) {
          return d.indexOf(t) >= 0;
        });
        var r = a.cs.substr(b, p.len);
        if (q.length && atBoundary(a, b + p.len) && b + p.len < a.cs.length && (q.length < d.length || /[시군구]$/.test(r))) {
          d = q;
          b += p.len;
          f = true;
        }
      }
      if (!f) {
        break;
      }
    }
    var s = {
      pos: b,
      sggs: d
    };
    return s;
  };
  ZipEngine.prototype._heads = function (a, b) {
    var c = this._headsFor(a, b, this._matchSido(a, 0));
    if (a.glued || !this._strict) {
      for (var i = this.maxSidoLen; i >= 2; i--) {
        var d = this.sidoAlias.get(a.cs.substr(0, i));
        if (d !== undefined && !c.some(function (g) {
          return g.sidoLen === i;
        })) {
          var f = {
            sd: d,
            len: i
          };
          c = c.concat(this._headsFor(a, null, f).filter(function (g) {
            return g.sidoLen === i;
          }));
        }
      }
    }
    return c;
  };
  ZipEngine.prototype._headsFor = function (a, b, c) {
    var d = [];
    var f = a.cs;
    var g = this;
    if (c) {
      var h = c.len;
      var p = this.sggOfSido[c.sd].filter(function (t1) {
        return !g.db.sgg[t1][1];
      });
      var q = this._matchSgg(a, h, c.sd);
      if (q) {
        var r = this._narrow(a, h + q.len, c.sd, q.sggs);
        var s = {
          sd: c.sd,
          sggs: r.sggs,
          pos: r.pos,
          sidoLen: c.len
        };
        d.push(s);
      } else if (p.length) {
        d.push({
          sd: c.sd,
          sggs: p,
          pos: this._narrow(a, h, c.sd, p).pos,
          sidoLen: c.len
        });
      } else {
        var t = this._matchSido(a, h);
        if (t && t.sd === c.sd) {
          var u = this._matchSgg(a, h + t.len, c.sd);
          if (u) {
            var v = this._narrow(a, h + t.len + u.len, c.sd, u.sggs);
            var w = {
              sd: c.sd,
              sggs: v.sggs,
              pos: v.pos
            };
            d.push(w);
          }
        }
        var x = this._matchSgg(a, h, null);
        if (x && !x.stem) {
          var y = x.sggs.map(function (t1) {
            return g.db.sgg[t1][0];
          }).filter(function (t1, idx, u1) {
            return u1.indexOf(t1) === idx;
          });
          if (y.length === 1) {
            d.push({
              sd: y[0],
              sggs: x.sggs,
              pos: h + x.len,
              fixSido: this.db.sido[c.sd] + "→" + this.db.sido[y[0]]
            });
          }
        }
        var z = {
          연기군: "세종특별자치시"
        };
        var a1 = f.slice(h, a.glued ? h + 3 : nextBoundary(a, h));
        if (z[a1] && this.db.sido.indexOf(z[a1]) >= 0) {
          var b1 = this.db.sido.indexOf(z[a1]);
          var c1 = {
            sd: b1,
            sggs: this.sggOfSido[b1],
            pos: h + a1.length,
            fixSido: this.db.sido[c.sd] + " " + a1 + "→" + z[a1],
            sidoLen: c.len
          };
          d.push(c1);
        }
        var d1 = a.glued ? h : nextBoundary(a, h);
        var f1 = f.slice(h, d1);
        var g1 = "";
        if (/^[가-힣]{1,4}[시군구]$/.test(f1) && d1 < f.length) {
          g1 = f1;
        } else if (a.glued) {
          var h1 = f.slice(h).match(/^([가-힣]{1,4}?[시군구])/);
          if (h1 && !this._prefixRoad(a, h, this.sggOfSido[c.sd])) {
            g1 = h1[1];
            d1 = h + h1[1].length;
          }
        }
        if (g1) {
          d.push({
            sd: c.sd,
            sggs: this.sggOfSido[c.sd],
            pos: d1,
            wide: true,
            skipped: g1,
            sidoLen: c.len
          });
        }
        var p1 = {
          sd: c.sd,
          sggs: this.sggOfSido[c.sd],
          pos: h,
          wide: true,
          skipped: "",
          sidoLen: c.len
        };
        d.push(p1);
      }
    }
    var q1 = this._matchSgg(a, 0, null);
    if (q1 && q1.stem && c && !c.plusSi) {
      q1 = null;
    }
    if (q1) {
      var r1 = this._narrow(a, q1.len, null, q1.sggs);
      var s1 = {
        sd: null,
        sggs: r1.sggs,
        pos: r1.pos,
        noSido: true
      };
      d.push(s1);
    }
    if (b && b.defaultSggs && b.defaultSggs.length) {
      d.push({
        sd: null,
        sggs: b.defaultSggs,
        pos: 0,
        byDefault: true
      });
    }
    return d;
  };
  ZipEngine.prototype._prefixRoad = function (a, b, c) {
    var d = a.cs;
    var f = null;
    var g = Math.min(this.maxRoadLen, d.length - b);
    for (var i = 0; i < c.length; i++) {
      var h = this.db.road[c[i]];
      for (var j = g; j >= 2; j--) {
        if (f && j < f.len) {
          break;
        }
        var p = d.substr(b, j);
        if (hasOwn.call(h, p) && this._endOk(a, b + j, "road")) {
          if (!f || j > f.len) {
            f = {
              name: p,
              len: j,
              sggs: [c[i]]
            };
          } else {
            f.sggs.push(c[i]);
          }
          break;
        }
      }
    }
    return f;
  };
  ZipEngine.prototype._prefixEmd = function (a, b, c) {
    var d = a.cs;
    var f = null;
    var g = Math.min(this.maxEmdLen, d.length - b);
    for (var i = 0; i < c.length; i++) {
      var h = this.emdSet[c[i]];
      for (var j = g; j >= 2; j--) {
        if (f && j < f.len) {
          break;
        }
        var p = d.substr(b, j);
        if (h.has(p) && this._endOk(a, b + j, "emd")) {
          if (!f || j > f.len) {
            f = {
              name: p,
              len: j,
              sggs: [c[i]]
            };
          } else {
            f.sggs.push(c[i]);
          }
          break;
        }
      }
    }
    return f;
  };
  ZipEngine.prototype._prefixRi = function (a, b, c, d) {
    var f = a.cs;
    var g = null;
    var h = Math.min(this.maxRiLen, f.length - b);
    for (var i = 0; i < c.length; i++) {
      var p = this.riMap[c[i]];
      for (var j = h; j >= 2; j--) {
        if (g && j < g.len) {
          break;
        }
        var q = f.substr(b, j);
        var r = p.get(q);
        if (r && (!d || r.indexOf(d) >= 0) && this._endOk(a, b + j, "ri")) {
          if (!g || j > g.len) {
            g = {
              name: q,
              len: j,
              sggs: [c[i]],
              emds: [r]
            };
          } else {
            g.sggs.push(c[i]);
            g.emds.push(r);
          }
          break;
        }
      }
    }
    return g;
  };
  function cmpPair(a, b, c, d) {
    if (a !== c) {
      return a - c;
    } else {
      return b - d;
    }
  }
  ZipEngine.prototype._roadZipWeights = function (a) {
    var b = new Map();
    for (var i = 0; i < a.length; i += 8) {
      var c = a[i + 2];
      var d = c === 0 ? 1 : Math.floor((a[i + 5] - a[i + 3]) / (c === 3 ? 1 : 2)) + 1;
      b.set(a[i + 7], (b.get(a[i + 7]) || 0) + Math.max(1, d));
    }
    return Array.from(b.entries()).sort(function (f, g) {
      return g[1] - f[1];
    });
  };
  ZipEngine.prototype._searchRoad = function (a, b, c, d, f, g) {
    var h = this.db.road[a][b];
    if (!h) {
      return null;
    }
    var p = this.db;
    var q;
    var r = [];
    for (q = 0; q < h.length; q += 8) {
      var s = h[q + 2];
      var t = false;
      var u = 0;
      if (s === 0) {
        if (h[q + 3] === c && h[q + 4] === d) {
          t = true;
          u = 3;
        }
      } else if ((s === 3 || s === 1 === (c % 2 === 1)) && cmpPair(h[q + 3], h[q + 4], c, d) <= 0 && cmpPair(c, d, h[q + 5], h[q + 6]) <= 0) {
        t = true;
        u = 2;
      }
      if (!t) {
        continue;
      }
      if (h[q + 1] === 1 === !!f) {
        u += 0.5;
      }
      if (g && p.emd[h[q]] === g) {
        u += 0.25;
      }
      var v = {
        k: q,
        q: u
      };
      r.push(v);
    }
    if (r.length) {
      r.sort(function (y, z) {
        return z.q - y.q;
      });
      var w = r[0];
      var x = {
        exact: true,
        zip: h[w.k + 7],
        emd: p.emd[h[w.k]],
        multi: r.length > 1 && r[1].q === w.q && h[r[1].k + 7] !== h[w.k + 7]
      };
      return x;
    }
    return {
      exact: false
    };
  };
  ZipEngine.prototype._nearestRoad = function (a, b, c, d) {
    var f = this.db.road[a][b];
    var g = this.db;
    var h = null;
    for (var i = 0; i < f.length; i += 8) {
      var p = f[i + 2];
      var q = f[i + 3];
      var r = p === 0 ? f[i + 3] : f[i + 5];
      var s = c < q ? q - c : c > r ? c - r : 0;
      var t = p === 3 || p === 0 ? 0 : p === 1 === (c % 2 === 1) ? 0 : 1;
      var u = d && g.emd[f[i]] !== d ? 0.5 : 0;
      var v = s * 2 + t + u;
      if (!h || v < h.score) {
        h = {
          score: v,
          k: i,
          d: s,
          lo: q,
          hi: r
        };
      }
    }
    return h;
  };
  ZipEngine.prototype._jibunZipWeights = function (a, b) {
    var c = new Map();
    for (var i = 0; i < a.length; i += 6) {
      if (b !== null && a[i] !== b) {
        continue;
      }
      c.set(a[i + 5], (c.get(a[i + 5]) || 0) + (a[i + 3] - a[i + 1] + 1));
    }
    return Array.from(c.entries()).sort(function (d, f) {
      return f[1] - d[1];
    });
  };
  ZipEngine.prototype._searchJibun = function (a, b, c, d) {
    var f;
    var g = null;
    for (f = 0; f < a.length; f += 6) {
      if (a[f] !== b) {
        continue;
      }
      if (cmpPair(a[f + 1], a[f + 2], c, d) <= 0 && cmpPair(c, d, a[f + 3], a[f + 4]) <= 0) {
        return {
          exact: true,
          zip: a[f + 5]
        };
      }
      if (!g && a[f + 1] <= c && c <= a[f + 3]) {
        g = {
          zip: a[f + 5]
        };
      }
    }
    if (g) {
      return {
        exact: false,
        loose: true,
        zip: g.zip
      };
    }
    var h = null;
    for (f = 0; f < a.length; f += 6) {
      if (a[f] !== b) {
        continue;
      }
      var p = c < a[f + 1] ? a[f + 1] - c : c - a[f + 3];
      if (!h || p < h.d) {
        h = {
          d: p,
          zip: a[f + 5],
          lo: a[f + 1],
          hi: a[f + 3]
        };
      }
    }
    if (h) {
      return {
        exact: false,
        near: h
      };
    } else {
      return null;
    }
  };
  var GRADE_SCORE = {
    정확: 100,
    상: 80,
    중: 60,
    하: 40
  };
  function makeResult(a, b, c, d, f) {
    var g = {
      zip: c ? pad5(c) : "",
      grade: a,
      conf: b || "",
      note: d || "",
      kind: "none",
      addr1: "",
      addr2: "",
      canon: null
    };
    if (f) {
      for (var h in f) {
        g[h] = f[h];
      }
    }
    g.score = a === "정확" ? 100 : a === "유사" ? GRADE_SCORE[b] || 40 : 0;
    return g;
  }
  function adjustGrade(a, b, c) {
    if (!a) {
      return a;
    }
    var d = {
      상: 3,
      중: 2,
      하: 1
    };
    if (a.grade === "정확") {
      a.grade = "유사";
      a.conf = b;
    } else if (a.grade === "유사" && d[a.conf] > d[b]) {
      a.conf = b;
    }
    a.score = a.grade === "유사" ? GRADE_SCORE[a.conf] : a.score;
    if (c) {
      a.note = c + " · " + a.note;
    }
    return a;
  }
  ZipEngine.prototype._roadAddr1 = function (a, b, c, d, f, g) {
    var h = [this.sggLabel(a)];
    if (b && /[읍면]$/.test(b)) {
      h.push(b);
    }
    h.push(c);
    if (f) {
      h.push((d ? "지하 " : "") + f + (g ? "-" + g : ""));
    }
    return h.join(" ");
  };
  ZipEngine.prototype._sggList = function (a) {
    var b = this;
    return a.slice(0, 3).map(function (c) {
      return b.sggLabel(c.g) + " " + pad5(c.zip);
    }).join(" / ") + (a.length > 3 ? " 외" : "");
  };
  ZipEngine.prototype._resolveRoad = function (a, b, c, d, f, g) {
    var h = a.cs;
    var p = b + c.len;
    var q = this;
    var r;
    var s;
    var t;
    var u = this._readNumber(a, p, "road");
    var v = u ? skipChars(a, p, u.len) : p;
    if (u && !u.marker && (/^ ?(?:번길|번안길|[가나다라마바사아자차카타파하]?길) ?\d/.test(restOf(a, v)) || !atBoundary(a, v) && /^[가-힣0-9]{0,6}(?:길|로)(?:\d|$)/.test(h.slice(v)))) {
      return {
        retry: true
      };
    }
    if (!u && /^ ?\d{1,5}(?:번길|번안길|[가나다라마바사아자차카타파하]?길)/.test(restOf(a, p))) {
      return {
        retry: true
      };
    }
    var w = u ? u.flag : false;
    var x = u ? u.m : 0;
    var y = u ? u.s : 0;
    if (u) {
      p = v;
    }
    var z = detailAfter(a, p);
    if (d && !/[읍면]$/.test(d)) {
      z = (z ? z + " " : "") + "(" + d + ")";
    }
    var a1 = g ? g + " · " : "";
    var b1 = f && f.wide && d && /[읍면]$/.test(d);
    if (b1) {
      var c1 = c.sggs.filter(function (b2) {
        return q.emdSet[b2].has(d);
      });
      if (!c1.length) {
        return null;
      }
      c = {
        name: c.name,
        len: c.len,
        sggs: c1
      };
    }
    if (u) {
      var d1 = [];
      for (r = 0; r < c.sggs.length; r++) {
        t = this._searchRoad(c.sggs[r], c.name, x, y, w, d);
        if (t && t.exact && (!b1 || t.emd === d)) {
          d1.push({
            g: c.sggs[r],
            zip: t.zip,
            r: t
          });
        }
      }
      if (d1.length) {
        d1.sort(function (b2, c2) {
          return (c2.r.emd === d ? 1 : 0) - (b2.r.emd === d ? 1 : 0);
        });
        var f1 = d1[0];
        var g1 = d1.length > 1 && d1.some(function (b2) {
          return b2.zip !== f1.zip;
        }) && (!d || !/[읍면]$/.test(d) || f1.r.emd !== d || d1.filter(function (b2) {
          return b2.r.emd === d;
        }).length !== 1);
        var h1 = {
          kind: "road",
          hitSggs: d1.length,
          addr1: this._roadAddr1(f1.g, f1.r.emd, c.name, w, x, y),
          addr2: z,
          canon: {
            g: f1.g,
            road: c.name,
            m: x,
            s: y
          }
        };
        if (g1) {
          return makeResult("유사", "중", f1.zip, a1 + "같은 도로명·건물번호가 여러 시·군·구에 있음(" + this._sggList(d1) + ")", h1);
        }
        if (f1.r.multi) {
          return makeResult("유사", "중", f1.zip, a1 + "도로명·건물번호 일치하나 우편번호 후보가 둘 이상", h1);
        }
        if (g) {
          return makeResult("유사", "상", f1.zip, a1 + "도로명·건물번호 일치", h1);
        }
        return makeResult("정확", "", f1.zip, "도로명·건물번호 일치", h1);
      }
      var p1 = [];
      for (r = 0; r < c.sggs.length; r++) {
        s = c.sggs[r];
        var q1 = this._nearestRoad(s, c.name, x, d);
        if (q1) {
          p1.push({
            g: s,
            n: q1,
            zip: this.db.road[s][c.name][q1.k + 7]
          });
        }
      }
      if (p1.length) {
        p1.sort(function (b2, c2) {
          return b2.n.score - c2.n.score;
        });
        var r1 = p1[0];
        var s1 = this.db.road[r1.g][c.name];
        var t1 = r1.n.k;
        var u1 = this._roadZipWeights(s1);
        var v1 = p1.length > 1;
        var w1 = v1 ? "하" : u1.length === 1 ? "상" : r1.n.d <= 10 ? "중" : "하";
        var x1 = v1 ? "같은 도로명이 " + p1.length + "개 시·군·구에 있어 가장 가까운 구간 기준" : u1.length === 1 ? "이 도로의 우편번호는 1개" : "가까운 구간 " + r1.n.lo + (r1.n.hi !== r1.n.lo ? "~" + r1.n.hi : "") + "번 기준";
        return makeResult("유사", g && w1 === "상" ? "중" : w1, s1[t1 + 7], a1 + "건물번호 " + x + (y ? "-" + y : "") + "이(가) 구간 밖 → " + x1, {
          kind: "road",
          addr1: this._roadAddr1(r1.g, this.db.emd[s1[t1]], c.name, w, x, y),
          addr2: z,
          canon: {
            g: r1.g,
            road: c.name,
            m: x,
            s: y
          }
        });
      }
    }
    var y1 = null;
    for (r = 0; r < c.sggs.length; r++) {
      s = c.sggs[r];
      var z1 = this._roadZipWeights(this.db.road[s][c.name]);
      if (!y1 || z1[0][1] > y1.w[0][1]) {
        y1 = {
          g: s,
          w: z1
        };
      }
    }
    var a2 = y1.w.length === 1 && c.sggs.length === 1;
    return makeResult("유사", a2 ? g ? "중" : "상" : "하", y1.w[0][0], a1 + "건물번호 없음 → " + (a2 ? "이 도로의 우편번호는 1개" : "도로 대표번호(후보 " + y1.w.length + "개 중 구간이 가장 넓은 번호)"), {
      kind: "road",
      addr1: this._roadAddr1(y1.g, "", c.name, false, 0, 0),
      addr2: z,
      canon: {
        g: y1.g,
        road: c.name,
        m: 0,
        s: 0
      }
    });
  };
  ZipEngine.prototype._resolveJibun = function (a, b, c, d, f, g, h, p) {
    var q = this._readNumber(a, b, "jibun");
    if (q && !q.flag && a.paren.indexOf("산") >= 0) {
      q.flag = true;
    }
    var r = q && q.flag ? 1 : 0;
    var s = q ? q.m : 0;
    var t = q ? q.s : 0;
    var u = q ? skipChars(a, b, q.len) : b;
    var v = detailAfter(a, u);
    var w = d + "|" + (f || "");
    var x = this;
    var y = g ? g + " · " : "";
    var z = !p && /이름 보정|행정동→법정동/.test(g || "");
    var a1 = f ? "리" : /[읍면]$/.test(d) ? "읍·면" : "동";
    var b1 = c.filter(function (b2) {
      return hasOwn.call(x.db.jibun[b2], w);
    });
    if (!b1.length) {
      return null;
    }
    function c1(b2) {
      var c2 = [f, q ? (r ? "산 " : "") + s + (t ? "-" + t : "") : "", v].filter(Boolean).join(" ");
      return {
        kind: "jibun",
        addr1: x.sggLabel(b2) + " " + d,
        addr2: c2,
        canon: {
          g: b2,
          emd: d,
          ri: f || "",
          m: s,
          s: t,
          san: r
        }
      };
    }
    var d1 = null;
    if (q) {
      var f1 = [];
      var g1 = [];
      var h1 = [];
      for (var i = 0; i < b1.length; i++) {
        var p1 = this._searchJibun(this.db.jibun[b1[i]][w], r, s, t);
        if (!p1) {
          continue;
        }
        if (p1.exact) {
          f1.push({
            g: b1[i],
            zip: p1.zip
          });
        } else if (p1.loose) {
          g1.push({
            g: b1[i],
            zip: p1.zip
          });
        } else if (p1.near) {
          h1.push({
            g: b1[i],
            zip: p1.near.zip,
            r: p1.near
          });
        }
      }
      var q1 = f1.length ? f1 : g1.length ? g1 : h1;
      var r1 = q1.length > 1 && q1.some(function (b2) {
        return b2.zip !== q1[0].zip;
      });
      if (f1.length) {
        var s1 = c1(f1[0].g);
        s1.hitSggs = f1.length;
        if (r1) {
          d1 = makeResult("유사", "중", f1[0].zip, y + "같은 " + a1 + "·번지가 여러 시·군·구에 있음(" + this._sggList(f1) + ")", s1);
        } else if (g) {
          d1 = makeResult("유사", z ? "중" : "상", f1[0].zip, y + "지번 일치", s1);
        } else {
          d1 = makeResult("정확", "", f1[0].zip, "지번 일치", s1);
        }
      } else if (g1.length) {
        d1 = makeResult("유사", r1 || z ? "중" : "상", g1[0].zip, y + "본번 " + s + "이(가) 구간 안(부번 경계만 다름)" + (r1 ? " · 후보 " + this._sggList(g1) : ""), c1(g1[0].g));
      } else if (h1.length) {
        h1.sort(function (b2, c2) {
          return b2.r.d - c2.r.d;
        });
        var t1 = h1[0];
        var u1 = this._jibunZipWeights(this.db.jibun[t1.g][w], null);
        var v1 = r1 ? "하" : u1.length === 1 ? "상" : f ? "중" : t1.r.d <= 20 ? "중" : "하";
        if ((g || z) && v1 === "상") {
          v1 = "중";
        }
        d1 = makeResult("유사", v1, t1.zip, y + a1 + " 일치, 번지 " + (r ? "산 " : "") + s + (t ? "-" + t : "") + "이(가) 구간 밖 → " + (u1.length === 1 ? "이 " + a1 + "의 우편번호는 1개" : "가까운 구간 " + t1.r.lo + "~" + t1.r.hi + "번지 기준"), c1(t1.g));
      }
      if (d1 && q.aptLike) {
        adjustGrade(d1, "중", "번지가 아파트 동·호 표기일 수 있음");
      }
    }
    if (!d1) {
      var w1 = b1[0];
      var x1 = this._jibunZipWeights(this.db.jibun[w1][w], null);
      var y1 = x1[0][1] / x1.reduce(function (b2, c2) {
        return b2 + c2[1];
      }, 0);
      var z1 = b1.length > 1 ? "하" : x1.length === 1 ? "상" : f ? y1 >= 0.5 ? "중" : "하" : x1.length <= 2 && y1 >= 0.6 ? "중" : "하";
      if ((g || z) && z1 === "상") {
        z1 = "중";
      }
      d1 = makeResult("유사", z1, x1[0][0], y + a1 + " 일치, " + (q ? "번지 자료 없음" : "번지 없음") + " → " + (x1.length === 1 ? "이 " + a1 + "의 우편번호는 1개" : "후보 " + x1.length + "개 중 지번 구간이 가장 넓은 번호") + (b1.length > 1 ? " · 같은 이름이 " + b1.length + "개 시·군·구에 있음" : ""), c1(w1));
    }
    if (q && h) {
      var a2 = this._roadInDetail(a, u, h);
      if (a2) {
        return a2;
      }
    }
    return d1;
  };
  ZipEngine.prototype._roadInDetail = function (a, b, c) {
    var d = a.cs.length;
    var f = 0;
    for (var i = b; i < d && f < 8; i++) {
      if (i !== b && !atBoundary(a, i)) {
        continue;
      }
      f++;
      var g = this._prefixRoad(a, i, c.sggs);
      if (!g) {
        continue;
      }
      var h = this._resolveRoad(a, i, g, null, c, "");
      if (h && h.grade === "정확") {
        var p = a.text.slice(a.map[Math.min(c.pos, d)], a.map[i]).trim();
        h.note = "도로명·건물번호 일치(지번과 함께 적힌 도로명 기준)";
        if (p) {
          h.addr2 = [h.addr2, "(" + p + ")"].filter(Boolean).join(" ");
        }
        return h;
      }
    }
    return null;
  };
  ZipEngine.prototype._resolvePobox = function (a, b) {
    var c = a.cs;
    var d = c.indexOf("사서함");
    if (d < 0) {
      return null;
    }
    var f = restOf(a, d + 3).match(/^ ?제? ?(\d{1,6})(?!\d)(?: ?- ?(\d{1,5})(?!\d))?/);
    if (!f) {
      return null;
    }
    var g = parseInt(f[1], 10);
    var h = f[2] ? parseInt(f[2], 10) : 0;
    var p = c.slice(b ? b.pos : 0, d);
    var q = b ? b.sggs : this.allSgg;
    var r = this.db;
    var s = [];
    for (var i = 0; i < r.pobox.length; i++) {
      var t = r.pobox[i];
      if (q.indexOf(t[0]) < 0) {
        continue;
      }
      var u = t[2] === t[4] && t[3] === t[5];
      var v = u ? t[2] === g && t[3] === h : cmpPair(t[2], t[3], g, h) <= 0 && cmpPair(g, h, t[4], t[5]) <= 0;
      if (!v) {
        continue;
      }
      var w = t[7] || "";
      var x = t[1].replace(/사서함$/, "");
      var y = (u ? 1 : 0) + (x && p.indexOf(x) >= 0 ? 4 : 0) + (w && p.indexOf(w) >= 0 ? 2 : 0) - (x && p && p.indexOf(x) < 0 && p.replace(w, "") ? 1 : 0);
      var z = {
        p: t,
        q: y
      };
      s.push(z);
    }
    if (!s.length) {
      return null;
    }
    s.sort(function (g1, h1) {
      return h1.q - g1.q;
    });
    var a1 = s[0];
    var b1 = s.filter(function (g1) {
      return g1.q === a1.q && g1.p[6] !== a1.p[6];
    }).length > 0;
    var c1 = a1.q >= 2 || !p;
    var d1 = this.sggLabel(a1.p[0]);
    var f1 = {
      kind: "pobox",
      addr1: [d1, a1.p[7] || ""].filter(Boolean).join(" "),
      addr2: a1.p[1] + " " + g + (h ? "-" + h : "") + "호",
      canon: {
        g: a1.p[0]
      }
    };
    if (b1) {
      return makeResult("유사", "중", a1.p[6], "사서함 번호가 같은 곳이 둘 이상", f1);
    }
    if (!c1) {
      return makeResult("유사", "중", a1.p[6], "사서함 번호 일치(사서함 이름·읍면은 확인되지 않음: " + a1.p[1] + ")", f1);
    }
    return makeResult("정확", "", a1.p[6], "사서함 일치", f1);
  };
  ZipEngine.prototype._fallbackRoad = function (a, b, c, d) {
    var f = a.cs;
    var g;
    if (!a.glued && this._strict) {
      var h = nextBoundary(a, b);
      var p = f.slice(b, h);
      var q = p.match(/^([가-힣0-9]{1,14}(?:로|길))(?=\d|$)/) || p.match(/^([가-힣0-9]{1,14}(?:로|길))/);
      if (q && q[1] === p && h < f.length) {
        var r = f.slice(h, nextBoundary(a, h));
        if (/^\d{0,4}[가-힣]?(?:번길|번안길|길)$/.test(r)) {
          q = [null, p + r];
        }
      }
      g = q && q[1];
    } else {
      var s = f.slice(b).match(/^([가-힣0-9]{1,14}(?:로|길))(?=(?:지하층?|지하|B)?\d)/) || f.slice(b).match(/^([가-힣0-9]{1,14}(?:로|길))(?![가-힣])/);
      g = s && s[1];
    }
    if (!g || g.length < 3 || c.sggs.length > 8) {
      return null;
    }
    var t = this.db;
    var u = null;
    var v = null;
    function w(z) {
      return z.replace(/번안길|번길/g, "길");
    }
    c.sggs.forEach(function (z) {
      var a1 = t.road[z];
      for (var b1 in a1) {
        if (!hasOwn.call(a1, b1)) {
          continue;
        }
        if (Math.abs(b1.length - g.length) > 1) {
          continue;
        }
        var c1 = w(b1) === w(g) ? 0.5 : editDistance(b1, g, 1);
        if (c1 > 1) {
          continue;
        }
        if (c1 === 1 && b1.replace(/\D/g, "") !== g.replace(/\D/g, "")) {
          continue;
        }
        if (!u || c1 < u.d) {
          if (u && u.name !== b1) {
            v = u;
          }
          var d1 = {
            d: c1,
            name: b1,
            sggs: [z]
          };
          u = d1;
        } else if (c1 === u.d && b1 === u.name) {
          u.sggs.push(z);
        } else if (!v || c1 < v.d) {
          v = {
            d: c1,
            name: b1
          };
        }
      }
    });
    if (!u || v && v.d === u.d && v.name !== u.name) {
      return null;
    }
    var x = {
      name: u.name,
      len: g.length,
      sggs: u.sggs
    };
    var y = this._resolveRoad(a, b, x, d, c, "도로명 보정(" + g + "→" + u.name + ")");
    if (!y || y.retry) {
      return null;
    }
    return adjustGrade(y, "중");
  };
  ZipEngine.prototype._resolveHjd = function (a, b, c, d) {
    var f = this;
    var g = b + c.len;
    var h = c.token;
    var p = c.alts.length === 1;
    var q = [];
    c.alts.forEach(function (x) {
      var y = f._resolveJibun(a, g, [x.g], x.emd, "", "행정동→법정동(" + h + "→" + x.emd + ")", d, p);
      if (y) {
        y._emd = x.emd;
        q.push(y);
      }
    });
    if (!q.length) {
      return null;
    }
    function r(x) {
      var y = 0;
      while (y < x.length && y < h.length && x.charAt(y) === h.charAt(y)) {
        y++;
      }
      return y;
    }
    q.sort(function (x, y) {
      return y.score - x.score || r(y._emd) - r(x._emd);
    });
    var s = q[0];
    var t = q.filter(function (x) {
      return x.score >= s.score;
    });
    var u = [];
    t.forEach(function (x) {
      if (u.indexOf(x.zip) < 0) {
        u.push(x.zip);
      }
    });
    var v = "행정동→법정동(" + h + "→" + s._emd + ")";
    if (!p) {
      v += u.length > 1 ? " · 이 행정동이 관할하는 법정동 " + c.alts.length + "곳에 같은 번지가 있어 우편번호가 갈림(" + u.slice(0, 4).join("·") + (u.length > 4 ? " 외" : "") + ")" : " · 관할 법정동 " + c.alts.length + "곳을 번지로 가려냄";
    }
    var w = s.note.replace(/^행정동→법정동\([^)]*\)\s*·\s*/, "");
    s.note = v + (w ? " · " + w : "");
    if (s.grade === "정확") {
      s.grade = "유사";
      s.conf = u.length > 1 ? "중" : "상";
      s.score = u.length > 1 ? 60 : 80;
    } else if (u.length > 1) {
      adjustGrade(s, "중");
    }
    delete s._emd;
    return s;
  };
  ZipEngine.prototype._hjdAlts = function (a, b) {
    if (!this.hjd.length) {
      return [];
    }
    var c = [];
    var d = this;
    b.forEach(function (f) {
      d.legalDongs(f, a).forEach(function (g) {
        if (d.emdSet[f].has(g)) {
          c.push({
            g: f,
            emd: g
          });
        }
      });
    });
    return c;
  };
  ZipEngine.prototype._looseEmd = function (a, b, c) {
    var d = a.cs;
    var f = this;
    var g;
    var h;
    var p = a.glued || !this._strict ? null : d.slice(b, nextBoundary(a, b));
    var q = (p || d.slice(b)).match(/^([가-힣]{1,5}?)(?:제?\d{1,2}(?:[.·,]\d{1,2})*)(동|가)/);
    if (q && (!p || q[0] === p || /^\d/.test(p.slice(q[0].length)))) {
      var r = q[1] + q[2];
      for (g = 0; g < c.length; g++) {
        if (this.emdSet[c[g]].has(r)) {
          return {
            name: r,
            token: q[0],
            len: q[0].length,
            sggs: c.filter(function (y) {
              return f.emdSet[y].has(r);
            }),
            fixed: "행정동→법정동(" + q[0] + "→" + r + ")"
          };
        }
      }
      h = this._hjdAlts(q[0], c);
      if (h.length) {
        return {
          alts: h,
          token: q[0],
          len: q[0].length
        };
      }
      var s = {
        unknown: q[0],
        len: q[0].length
      };
      return s;
    }
    var t = p ? /^[가-힣]{2,6}[읍면동]$/.test(p) ? [null, p] : null : d.slice(b).match(/^([가-힣]{2,6}?[읍면동])(?![가-힣]{0,1}[읍면동](?![가-힣]))/);
    if (t) {
      var u = t[1];
      var v = null;
      var w = false;
      h = this._hjdAlts(u, c);
      if (h.length) {
        return {
          alts: h,
          token: u,
          len: u.length
        };
      }
      c.forEach(function (y) {
        f.emdSet[y].forEach(function (z) {
          if (z.charAt(z.length - 1) !== u.charAt(u.length - 1)) {
            return;
          }
          if (editDistance(z, u, 1) === 1) {
            var a1 = {
              name: z,
              sggs: [y]
            };
            if (!v) {
              v = a1;
            } else if (v.name === z) {
              v.sggs.push(y);
            } else {
              w = true;
            }
          }
        });
      });
      if (v && !w) {
        return {
          name: v.name,
          token: u,
          len: u.length,
          sggs: v.sggs,
          fixed: "읍면동 이름 보정(" + u + "→" + v.name + ")"
        };
      }
      var x = {
        unknown: u,
        len: u.length
      };
      return x;
    }
    return null;
  };
  ZipEngine.prototype._looseRi = function (a, b, c, d) {
    var f = a.cs;
    var g = this;
    var h;
    var p = a.glued || !this._strict ? null : f.slice(b, nextBoundary(a, b));
    var q = (p || f.slice(b)).match(/^([가-힣]{1,5}?)(\d{1,2})?리(?![가-힣]*리)/);
    if (!q || p && q[0] !== p && !/^(?:산?\d)/.test(p.slice(q[0].length))) {
      return null;
    }
    var r = q[0];
    var s = q[1] + "리";
    if (q[2]) {
      for (h = 0; h < c.length; h++) {
        var t = this.riMap[c[h]].get(s);
        if (t && (!d || t.indexOf(d) >= 0)) {
          return {
            name: s,
            len: r.length,
            sggs: [c[h]],
            emds: [t],
            fixed: "행정리→법정리(" + r + "→" + s + ")"
          };
        }
      }
    }
    var u = null;
    var v = false;
    c.forEach(function (w) {
      g.riMap[w].forEach(function (x, idx) {
        if (d && x.indexOf(d) < 0) {
          return;
        }
        if (editDistance(idx, s, 1) === 1) {
          var y = {
            name: idx,
            sggs: [w],
            emds: [x]
          };
          if (!u) {
            u = y;
          } else if (u.name !== idx) {
            v = true;
          }
        }
      });
    });
    if (u && !v) {
      u.len = r.length;
      u.fixed = "리 이름 보정(" + s + "→" + u.name + ")";
      return u;
    }
    return null;
  };
  ZipEngine.prototype._resolveTail = function (a, b) {
    var c = b.pos;
    var d = b.sggs;
    var f = this;
    var g = [];
    var h = c;
    function p(y1) {
      if (y1 && !y1.retry) {
        g.push(y1);
      }
      return y1;
    }
    function q() {
      return g.some(function (y1) {
        return y1.grade === "정확";
      });
    }
    function r(y1, z1, a2, b2) {
      var c2 = f._resolveRoad(a, y1, z1, a2, b, b2);
      if (c2 && c2.retry) {
        c2 = f._fallbackRoad(a, y1, b, a2);
      }
      return p(c2);
    }
    var s = this._resolvePobox(a, b);
    if (s) {
      return s;
    }
    var t = this._prefixRoad(a, c, d);
    var u = this._prefixEmd(a, c, d);
    var v = "";
    if (!u) {
      var w = this._looseEmd(a, c, d);
      if (w && w.name) {
        u = w;
        v = w.fixed;
        u.shown = w.token;
      } else if (w && w.alts && !t) {
        var x = this._resolveHjd(a, c, w, b);
        if (x) {
          p(x);
        }
        if (!q()) {
          p(this._fallbackRoad(a, c + w.len, b, w.token));
        }
      } else if (w && w.unknown && !t) {
        var y = this._prefixRoad(a, c + w.len, d);
        if (y) {
          r(c + w.len, y, w.unknown, "");
        } else {
          p(this._fallbackRoad(a, c + w.len, b, w.unknown));
        }
      }
    }
    if (t && u && !v) {
      if (t.len > u.len) {
        u = null;
      } else if (u.len > t.len) {
        t = null;
      }
    }
    var z = t && (!u || t.len >= u.len);
    if (z) {
      r(c, t, null, "");
    }
    if (u && !q()) {
      var a1 = c + u.len;
      var b1 = u.sggs;
      if (a1 > h) {
        h = a1;
      }
      var c1 = this._prefixRoad(a, a1, d);
      var d1 = u.shown && /이름 보정/.test(v) ? u.shown : u.name;
      if (c1) {
        r(a1, c1, d1, "");
      }
      if (!q()) {
        var f1 = this._prefixRi(a, a1, b1, u.name);
        var g1 = v;
        if (!f1 && /[읍면]$/.test(u.name)) {
          var h1 = this._looseRi(a, a1, b1, u.name);
          if (h1 && h1.name) {
            f1 = h1;
            g1 = [v, h1.fixed].filter(Boolean).join(" · ");
          }
        }
        if (f1) {
          var p1 = a1 + f1.len;
          if (p1 > h) {
            h = p1;
          }
          var q1 = this._prefixRoad(a, p1, d);
          if (q1) {
            r(p1, q1, d1, "");
          }
          if (!q()) {
            p(this._resolveJibun(a, p1, f1.sggs, u.name, f1.name, g1, b));
          }
        } else if (!c1) {
          if (/[읍면]$/.test(u.name)) {
            p(this._emdOnly(a, a1, b1, u.name, v));
            p(this._fallbackRoad(a, a1, b, u.name));
          } else {
            p(this._resolveJibun(a, a1, b1, u.name, "", v, b));
            if (!q()) {
              p(this._fallbackRoad(a, a1, b, u.name));
            }
          }
        }
      }
    }
    if (!z && t && !q()) {
      r(c, t, null, "");
    }
    if (!u && !q()) {
      var r1 = this._prefixRi(a, c, d, null);
      var s1 = "";
      if (!r1) {
        var t1 = this._looseRi(a, c, d, null);
        if (t1 && t1.name) {
          r1 = t1;
          s1 = t1.fixed;
        }
      }
      if (r1) {
        var u1 = c + r1.len;
        var v1 = r1.emds[0];
        if (u1 > h) {
          h = u1;
        }
        var w1 = this._prefixRoad(a, u1, d);
        if (w1) {
          r(u1, w1, r1.sggs.length === 1 && v1.length === 1 ? v1[0] : null, "");
        }
        if (!q()) {
          if (r1.sggs.length === 1 && v1.length === 1) {
            p(this._resolveJibun(a, u1, r1.sggs, v1[0], r1.name, [s1, "읍·면 보충(" + v1[0] + ")"].filter(Boolean).join(" · "), b));
          } else {
            var x1 = [];
            r1.sggs.forEach(function (y1, idx) {
              r1.emds[idx].forEach(function (z1) {
                x1.push(f._resolveJibun(a, u1, [y1], z1, r1.name, "읍·면 보충(" + z1 + ", 같은 리 이름 " + r1.emds[idx].length + "곳)", b));
              });
            });
            x1 = x1.filter(Boolean).sort(function (y1, z1) {
              return z1.score - y1.score;
            });
            if (x1.length) {
              p(adjustGrade(x1[0], "중"));
            }
          }
        }
      }
      if (!t && !q()) {
        p(this._fallbackRoad(a, c, b, null));
      }
    }
    if (!g.length) {
      return null;
    }
    g.sort(function (y1, z1) {
      return z1.score - y1.score;
    });
    return g[0];
  };
  ZipEngine.prototype._resolveBuilding = function (a, b, c) {
    if (!this.bldKey) {
      return null;
    }
    var d = a.cs;
    var f = d.length;
    var g = this;
    var h = null;
    if (c == null) {
      c = b.pos;
    }
    if (c >= f) {
      return null;
    }
    for (var i = 0; i < b.sggs.length; i++) {
      var p = b.sggs[i];
      var q = this._bldOf(p);
      if (!q || !q.size) {
        continue;
      }
      for (var j = 0; j < 2 && !h; j++) {
        var r = 0;
        var s = j ? 40 : 10;
        for (var k = c; k < f && r < s; k++) {
          if (!j && k !== c && !atBoundary(a, k)) {
            continue;
          }
          r++;
          var t = Math.min(q.maxLen, f - k);
          for (var n = t; n >= 3; n--) {
            if (h && n <= h.len && h.g !== p) {
              break;
            }
            var u = d.substr(k, n);
            var v = q.get(u);
            if (!v) {
              continue;
            }
            if (!h || n > h.len) {
              h = {
                g: p,
                name: u,
                len: n,
                pos: k,
                hits: v,
                mid: !!j
              };
            }
            break;
          }
        }
      }
    }
    if (!h) {
      return null;
    }
    var w = [];
    var x = [];
    h.hits.forEach(function (b1) {
      if (w.indexOf(b1[1]) < 0) {
        w.push(b1[1]);
        x.push(b1[0]);
      }
    });
    var y = a.text.slice(a.map[h.pos], a.map[Math.min(h.pos + h.len, f)]).trim() || h.name;
    var z = w.length === 1 && !h.mid ? "상" : "중";
    var a1 = "건물명 일치(" + y + ")" + (w.length > 1 ? " · 같은 이름이 이 시·군·구에 " + w.length + "곳(" + w.slice(0, 3).join("·") + ")" : "");
    return makeResult("유사", z, parseInt(w[0], 10), a1, {
      kind: "bld",
      addr1: [g.sggLabel(h.g), x[0]].filter(Boolean).join(" "),
      addr2: [y, detailAfter(a, h.pos + h.len)].filter(Boolean).join(" "),
      canon: {
        g: h.g,
        emd: x[0] || ""
      }
    });
  };
  ZipEngine.prototype._emdOnly = function (a, b, c, d, f) {
    var g = new Map();
    var h = this;
    var p = null;
    c.forEach(function (r) {
      var s = h.db.jibun[r];
      for (var t in s) {
        if (!hasOwn.call(s, t) || t.slice(0, t.indexOf("|")) !== d) {
          continue;
        }
        p = p === null ? r : p;
        h._jibunZipWeights(s[t], null).forEach(function (u) {
          g.set(u[0], (g.get(u[0]) || 0) + u[1]);
        });
      }
    });
    if (!g.size) {
      return null;
    }
    var q = Array.from(g.entries()).sort(function (r, s) {
      return s[1] - r[1];
    });
    return makeResult("유사", q.length === 1 ? "중" : "하", q[0][0], (f ? f + " · " : "") + "읍·면까지만 확인 → 후보 " + q.length + "개 중 지번 구간이 가장 넓은 번호", {
      kind: "jibun",
      addr1: this.sggLabel(p) + " " + d,
      addr2: detailAfter(a, b),
      canon: {
        g: p,
        emd: d
      }
    });
  };
  ZipEngine.prototype._pass = function (a, b) {
    var c = this._heads(a, b);
    var d = null;
    for (var i = 0; i < c.length; i++) {
      var f = c[i];
      var g = this._resolveTail(a, f);
      if (!g) {
        continue;
      }
      if (f.byDefault) {
        adjustGrade(g, "상", "기본 지역 적용");
      }
      if (f.fixSido) {
        adjustGrade(g, "상", "시도 보정(" + f.fixSido + ")");
      }
      if (f.wide) {
        var h = g.canon && g.canon.g !== undefined ? this.db.sgg[g.canon.g][1] : "";
        var p = g.grade === "정확" && g.hitSggs === 1;
        adjustGrade(g, p ? "상" : "중", f.skipped ? "시군구 보정(" + f.skipped + "→" + h + ")" : "시군구 보충(" + h + ")");
      }
      if (f.noSido && f.sggs.length > 1 && g.grade === "정확" && g.canon && this._sameNameElsewhere(f.sggs, g)) {
        adjustGrade(g, "상", "시·도 없음");
      }
      if (!d || g.score > d.score) {
        d = g;
      }
      if (d.grade === "정확") {
        break;
      }
    }
    var q = {
      best: d,
      heads: c
    };
    return q;
  };
  ZipEngine.prototype._sameNameElsewhere = function (a, b) {
    var c = this.db;
    var d = c.sgg[b.canon.g][0];
    return a.some(function (f) {
      return c.sgg[f][0] !== d;
    });
  };
  ZipEngine.prototype._lookup = function (a, b) {
    var c = prepText(a);
    if (!c.cs) {
      return makeResult("실패", "", 0, "주소가 비어 있음", {
        zipFound: c.zipFound
      });
    }
    this._strict = true;
    var d = this._pass(c, b);
    var f = d.best;
    var g = d.heads;
    if (!c.glued && (!f || f.score < GRADE_SCORE.상)) {
      this._strict = false;
      var h;
      try {
        h = this._pass(c, b);
      } finally {
        this._strict = true;
      }
      if (h.best && (!f || h.best.score > f.score)) {
        adjustGrade(h.best, "중", "붙여 쓴 글자를 나눠 해석");
        if (!f || h.best.score > f.score) {
          f = h.best;
          g = h.heads;
        }
      }
    }
    if (c.paren.length && g.length && (!f || f.score < GRADE_SCORE.상)) {
      var p = g.filter(function (x) {
        return !x.wide && !x.byDefault;
      })[0] || g[0];
      var q = [];
      var r = this;
      p.sggs.forEach(function (x) {
        var y = r.db.sgg[x];
        var z = r.db.sido[y[0]] + " " + y[1].split(" ")[0];
        if (q.indexOf(z) < 0) {
          q.push(z);
        }
      });
      if (q.length <= 8) {
        for (var i = 0; i < c.paren.length; i++) {
          var s = [];
          for (var j = 0; j < q.length; j++) {
            var t = null;
            try {
              t = this._lookupPlain(q[j] + " " + c.paren[i]);
            } catch (err) {
              t = null;
            }
            if (t && t.grade === "정확") {
              s.push(t);
            }
          }
          if (s.length && s.every(function (x) {
            return x.zip === s[0].zip;
          })) {
            var u = adjustGrade(s[0], "상", "괄호 안 주소 기준");
            var v = c.text.slice(c.map[Math.min(p.pos, c.cs.length)]).trim();
            u.addr2 = [u.addr2, v ? "(" + v + ")" : ""].filter(Boolean).join(" ");
            f = u;
            break;
          }
        }
      }
    }
    if (!f) {
      f = makeResult("실패", "", 0, !g.length ? "시·도와 시·군·구를 알 수 없음" : "읍면동·도로명을 찾지 못함", {});
      if (!g.length) {
        var w = this._resolvePobox(c, null);
        if (w) {
          f = w;
        }
      }
    }
    if (c.rangeMark && f.score > GRADE_SCORE.중) {
      adjustGrade(f, "중", "번호에 물결표(~) 사용");
    }
    f.zipFound = c.zipFound;
    if (!f.addr1) {
      f.addr1 = c.text;
      f.addr2 = c.paren.length ? "(" + c.paren.join(", ") + ")" : "";
    }
    return f;
  };
  ZipEngine.prototype._lookupPlain = function (a) {
    var b = prepText(a);
    if (!b.cs) {
      return null;
    }
    this._strict = true;
    return this._pass(b, null).best;
  };
  ZipEngine.prototype.lookup = function (a, b) {
    var c;
    var d = toStr(a);
    try {
      c = this._lookup(d, b);
    } catch (err) {
      this._strict = true;
      c = makeResult("실패", "", 0, "주소를 분석하지 못함", {});
      c.addr1 = d.slice(0, 200);
    }
    if (c.grade === "실패" && c.note === "시·도와 시·군·구를 알 수 없음") {
      var f = d.replace(/\s+/g, " ").trim().slice(0, 400).split(" ");
      for (var i = 1; i <= 3 && i < f.length; i++) {
        var g;
        try {
          g = this._lookup(f.slice(i).join(" "), null);
        } catch (err) {
          this._strict = true;
          g = null;
        }
        if (g && g.grade !== "실패") {
          adjustGrade(g, "상", "앞 글자(" + f.slice(0, i).join(" ") + ") 건너뜀");
          if (!g.zipFound) {
            g.zipFound = c.zipFound;
          }
          return g;
        }
      }
    }
    if (c.grade === "실패" && this.bldKey) {
      var h = null;
      try {
        h = this._lookupBuilding(d, b);
      } catch (err) {
        this._strict = true;
        h = null;
      }
      if (h) {
        if (!h.zipFound) {
          h.zipFound = c.zipFound;
        }
        return h;
      }
    }
    return c;
  };
  ZipEngine.prototype._lookupBuilding = function (a, b) {
    var c = prepText(a);
    if (!c.cs) {
      return null;
    }
    this._strict = true;
    var d = this._heads(c, b);
    var f = null;
    for (var i = 0; i < d.length; i++) {
      var g = d[i];
      if (g.wide) {
        continue;
      }
      var h = this._resolveBuilding(c, g, g.pos);
      if (h && (!f || h.score > f.score)) {
        if (g.byDefault) {
          adjustGrade(h, "중", "기본 지역 적용");
        }
        f = h;
      }
    }
    return f;
  };
  ZipEngine.prototype.search = function (a, b) {
    b = b || 60;
    var c = this.db;
    var d = this;
    var f = [];
    var g = {};
    var h = prepText(toStr(a));
    if (!h.cs) {
      return f;
    }
    this._strict = true;
    var p = this._heads(h, null);
    var q = null;
    for (var i = 0; i < p.length; i++) {
      if (!p[i].wide && !p[i].byDefault) {
        q = p[i];
        break;
      }
    }
    var r = q ? q.sggs : this.allSgg;
    var s = h.cs.slice(q ? q.pos : 0);
    var t = s.match(/(\d+)(?:-(\d+))?\s*$/);
    var u = t ? parseInt(t[1], 10) : 0;
    var v = t && t[2] ? parseInt(t[2], 10) : 0;
    var w = normText(t ? s.slice(0, t.index) : s);
    if (w.length < 2) {
      return f;
    }
    var x = !q && w.length < 3;
    if (x) {
      return f;
    }
    function y(p2) {
      var q2 = p2.kind + "|" + p2.g + "|" + p2.addr + "|" + p2.zip;
      if (g[q2]) {
        return;
      }
      g[q2] = 1;
      f.push(p2);
    }
    function z(p2, q2, r2) {
      if (p2 === q2) {
        return p2 + r2;
      } else {
        return p2 + "~" + q2 + r2;
      }
    }
    for (var j = 0; j < r.length && f.length < b * 3; j++) {
      var a1 = r[j];
      var b1 = c.road[a1];
      var c1;
      for (c1 in b1) {
        if (!hasOwn.call(b1, c1) || c1.indexOf(w) < 0) {
          continue;
        }
        var d1 = b1[c1];
        var f1 = new Map();
        var g1;
        for (g1 = 0; g1 < d1.length; g1 += 8) {
          var h1 = d1[g1 + 2];
          var p1 = d1[g1 + 3];
          var q1 = h1 === 0 ? d1[g1 + 3] : d1[g1 + 5];
          if (u && (!(p1 <= u) || !(u <= q1))) {
            continue;
          }
          if (u && h1 !== 0 && h1 !== 3 && h1 === 1 !== (u % 2 === 1)) {
            continue;
          }
          var r1 = d1[g1 + 7];
          var s1 = f1.get(r1);
          var t1 = {
            lo: p1,
            hi: q1,
            emd: c.emd[d1[g1]]
          };
          if (!s1) {
            f1.set(r1, s1 = t1);
          } else {
            if (p1 < s1.lo) {
              s1.lo = p1;
            }
            if (q1 > s1.hi) {
              s1.hi = q1;
            }
          }
        }
        f1.forEach(function (p2, idx) {
          y({
            zip: pad5(idx),
            kind: "road",
            g: a1,
            addr: d._roadAddr1(a1, p2.emd, c1, false, u, v),
            range: z(p2.lo, p2.hi, "번"),
            exact: !!u
          });
        });
      }
      var u1 = c.jibun[a1];
      var v1;
      for (v1 in u1) {
        if (!hasOwn.call(u1, v1)) {
          continue;
        }
        var w1 = v1.indexOf("|");
        var x1 = v1.slice(0, w1);
        var y1 = v1.slice(w1 + 1);
        if ((y1 || x1).indexOf(w) < 0 && x1.indexOf(w) < 0) {
          continue;
        }
        var z1 = u1[v1];
        var a2 = new Map();
        for (g1 = 0; g1 < z1.length; g1 += 6) {
          if (u && (!(z1[g1 + 1] <= u) || !(u <= z1[g1 + 3]))) {
            continue;
          }
          var b2 = z1[g1 + 5];
          var c2 = a2.get(b2);
          var d2 = {
            lo: z1[g1 + 1],
            hi: z1[g1 + 3]
          };
          if (!c2) {
            a2.set(b2, c2 = d2);
          } else {
            if (z1[g1 + 1] < c2.lo) {
              c2.lo = z1[g1 + 1];
            }
            if (z1[g1 + 3] > c2.hi) {
              c2.hi = z1[g1 + 3];
            }
          }
        }
        a2.forEach(function (p2, idx) {
          y({
            zip: pad5(idx),
            kind: "jibun",
            g: a1,
            addr: [d.sggLabel(a1), x1, y1].filter(Boolean).join(" ") + (u ? " " + u + (v ? "-" + v : "") : ""),
            range: z(p2.lo, p2.hi, "번지"),
            exact: !!u
          });
        });
      }
    }
    if (this.bldKey && w.length >= 2) {
      for (j = 0; j < r.length && f.length < b * 3; j++) {
        var f2 = this._bldOf(r[j]);
        if (!f2) {
          continue;
        }
        var g2 = r[j];
        var h2 = 0;
        f2.forEach(function (p2, idx) {
          if (h2 > 40 || idx.indexOf(w) < 0) {
            return;
          }
          h2++;
          p2.forEach(function (q2) {
            y({
              zip: q2[1],
              kind: "bld",
              g: g2,
              addr: [d.sggLabel(g2), q2[0], idx].filter(Boolean).join(" "),
              range: "건물명",
              exact: idx === w
            });
          });
        });
      }
    }
    f.sort(function (p2, q2) {
      return (q2.exact ? 1 : 0) - (p2.exact ? 1 : 0) || p2.addr.localeCompare(q2.addr, "ko") || p2.zip.localeCompare(q2.zip);
    });
    return f.slice(0, b);
  };
  ZipEngine.prototype.parseRegion = function (a) {
    var b = prepText(a);
    if (!b.cs) {
      return [];
    }
    this._strict = true;
    var c = this._heads(b, null).filter(function (d) {
      return !d.wide && d.pos >= b.cs.length;
    });
    if (c.length) {
      return c[0].sggs;
    } else {
      return [];
    }
  };
  ZipEngine.preprocess = prepText;
  ZipEngine.normName = normText;
  ZipEngine.pad5 = pad5;
  ZipEngine.editDistance = editDistance;
  return ZipEngine;
});