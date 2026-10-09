/*! 우편번호 자동검색기 v1.4 (출품본) — 우편번호 DB 빌더 | (c) 2026 이희재 · 정읍우체국 | 2026 공공 AI 대전환 챌린지 출품본 — 대회 규정에 따른 사용권 부여 */
(function (a, b) {
  if (typeof module === "object" && module.exports) {
    module.exports = b();
  } else {
    a.ZipDbBuild = b();
  }
})(typeof self !== "undefined" ? self : this, function () {
  'use strict';

  function a(g) {
    if (g.charCodeAt(0) === 65279) {
      g = g.slice(1);
    }
    return g.split(/\r?\n/);
  }
  function b(g) {
    var h = parseInt(g, 10);
    if (isNaN(h)) {
      return 0;
    } else {
      return h;
    }
  }
  function c(g) {
    var h = String(g == null ? "" : g);
    if (h.normalize) {
      h = h.normalize("NFKC");
    }
    return h.replace(/\s+/g, "").replace(/\([^)]*\)/g, "").replace(/[·.\u318d\u119e\u30fb\u2022\u2027\u2219\u22c5]/g, "").replace(/[a-z]/g, function (p) {
      return p.toUpperCase();
    });
  }
  function d(g) {
    var sidoList = [];
    var sidoIndex = new Map();
    var sggList = [];
    var sggIndex = new Map();
    var nameList = [""];
    var nameIndex = new Map([["", 0]]);
    var roadRanges = [];
    var jibunRanges = [];
    var poboxRanges = [];
    var stats = {
      road: 0,
      jibun: 0,
      pobox: 0
    };
    function sidoId(b1) {
      var c1 = sidoIndex.get(b1);
      if (c1 === undefined) {
        c1 = sidoList.length;
        sidoList.push(b1);
        sidoIndex.set(b1, c1);
      }
      return c1;
    }
    function sggId(b1, c1) {
      var d1 = b1 + "|" + c1;
      var f1 = sggIndex.get(d1);
      if (f1 === undefined) {
        f1 = sggList.length;
        sggList.push([b1, c1]);
        sggIndex.set(d1, f1);
        roadRanges.push({});
        jibunRanges.push({});
      }
      return f1;
    }
    function nameId(b1) {
      var c1 = nameIndex.get(b1);
      if (c1 === undefined) {
        c1 = nameList.length;
        nameList.push(b1);
        nameIndex.set(b1, c1);
      }
      return c1;
    }
    var roadLines = a(g.road || "");
    var roadHeader = (roadLines[0] || "").split("|");
    if (roadHeader.indexOf("도로명") < 0 || roadHeader.indexOf("범위종류") < 0) {
      throw new Error("도로명 범위 파일의 머리글을 찾지 못했습니다.");
    }
    var col = {};
    roadHeader.forEach(function (b1, idx) {
      col[b1.trim()] = idx;
    });
    var cZip = col.우편번호;
    var cSido = col.시도;
    var cSgg = col.시군구;
    var cEup = col.읍면;
    var cRoad = col.도로명;
    var cUnder = col.지하여부;
    var cFromMain = col["시작건물번호(주)"];
    var cFromSub = col["시작건물번호(부)"];
    var cToMain = col["끝건물번호(주)"];
    var cToSub = col["끝건물번호(부)"];
    var cRangeKind = col.범위종류;
    for (var i = 1; i < roadLines.length; i++) {
      var h = roadLines[i].split("|");
      if (h.length < 15 || !h[cZip]) {
        continue;
      }
      var p = sggId(sidoId(h[cSido]), h[cSgg]);
      var q = c(h[cRoad]);
      var r = roadRanges[p][q] ||= [];
      var s = b(h[cRangeKind]);
      r.push(nameId(h[cEup]), b(h[cUnder]), s, b(h[cFromMain]), b(h[cFromSub]), s === 0 ? 0 : b(h[cToMain]), s === 0 ? 0 : b(h[cToSub]), b(h[cZip]));
      stats.road++;
    }
    roadLines = a(g.jibun || "");
    roadHeader = (roadLines[0] || "").split("|");
    if (roadHeader.indexOf("읍면동") < 0 || roadHeader.indexOf("시작주번지") < 0) {
      throw new Error("지번 범위 파일의 머리글을 찾지 못했습니다.");
    }
    col = {};
    roadHeader.forEach(function (b1, idx) {
      col[b1.trim()] = idx;
    });
    var jZip = col.우편번호;
    var jSido = col.시도;
    var jSgg = col.시군구;
    var jEmd = col.읍면동;
    var jRi = col.리명;
    var jSan = col.산여부;
    var jFromMain = col.시작주번지;
    var jFromSub = col.시작부번지;
    var jToMain = col.끝주번지;
    var jToSub = col.끝부번지;
    for (i = 1; i < roadLines.length; i++) {
      h = roadLines[i].split("|");
      if (h.length < 14 || !h[jZip]) {
        continue;
      }
      p = sggId(sidoId(h[jSido]), h[jSgg]);
      var t = c(h[jEmd]) + "|" + c(h[jRi]);
      r = jibunRanges[p][t] ||= [];
      var u = h[jToMain] === "";
      var v = b(h[jFromMain]);
      var w = b(h[jFromSub]);
      r.push(b(h[jSan]), v, w, u ? v : b(h[jToMain]), u ? w : b(h[jToSub]), b(h[jZip]));
      stats.jibun++;
    }
    if (g.pobox) {
      roadLines = a(g.pobox);
      for (i = 1; i < roadLines.length; i++) {
        h = roadLines[i].split("|");
        if (h.length < 9 || !h[0]) {
          continue;
        }
        var x = sidoIndex.get(h[1]);
        if (x === undefined) {
          x = sidoId(h[1]);
        }
        p = sggId(x, h[2]);
        var y = b(h[5]);
        var z = b(h[6]);
        var a1 = h[7] !== "";
        poboxRanges.push([p, c(h[4]), y, z, a1 ? b(h[7]) : y, a1 ? b(h[8]) : z, b(h[0]), c(h[3])]);
        stats.pobox++;
      }
    }
    var db = {
      ver: 2,
      date: g.date || "",
      stats: stats,
      sido: sidoList,
      sgg: sggList,
      emd: nameList,
      road: roadRanges,
      jibun: jibunRanges,
      pobox: poboxRanges
    };
    return db;
  }
  var f = {
    build: d
  };
  return f;
});