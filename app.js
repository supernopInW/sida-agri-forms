(() => {
  'use strict';

  const ACCESS_PIN = '123456';
  const STORAGE_KEY = 'sida_agri_data_v2';
  const LEGACY_STORAGE_KEY = 'sida_agri_data_v1';
  const AUTH_SESSION_KEY = 'sida_agri_auth_ok';

  // Application State
  let appData = null;
  let state = {
    view: 'dashboard', // 'dashboard' | 'ro' | 'rt' | 'rm'
    dashScope: 'all', // 'all' | tambonId
    tambonId: 't1',
    villageId: 't1_m1',
    search: '',
    cropFilter: 'all',
    showAllCrops: false, // false = only crops with data, true = all 10 crops
    page: 1,
    pageSize: 50,
  };
  let dashCharts = [];

  // DOM Shortcuts
  const $ = (id) => document.getElementById(id);

  // Formatters
  function fmtNum(n, maxDec = 2) {
    if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '';
    const v = Number(n);
    if (v === 0) return '';
    return v.toLocaleString('th-TH', { maximumFractionDigits: maxDec });
  }

  function fmtNumZero(n, maxDec = 2) {
    const v = Number(n || 0);
    return v.toLocaleString('th-TH', { maximumFractionDigits: maxDec });
  }

  function round4(n) {
    return Math.round((Number(n) || 0) * 10000) / 10000;
  }

  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
      t.hidden = true;
    }, 2800);
  }

  // Persistence
  function migrateNewToStanding(dataObj) {
    if (!dataObj || !dataObj.tambons) return;
    dataObj.tambons.forEach((t) => {
      t.villages.forEach((v) => {
        v.plots.forEach((p) => {
          if (!p.c) return;
          Object.keys(p.c).forEach((cid) => {
            const cv = p.c[cid];
            const n = Number(cv.n || 0);
            if (n > 0) {
              cv.s = round4(Number(cv.s || 0) + n);
              cv.n = 0;
            }
          });
        });
      });
    });
  }

  function loadData() {
    try {
      const savedV2 = localStorage.getItem(STORAGE_KEY);
      if (savedV2) {
        appData = JSON.parse(savedV2);
        return;
      }
      const savedV1 = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (savedV1) {
        appData = JSON.parse(savedV1);
        migrateNewToStanding(appData);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
        return;
      }
    } catch (e) {
      console.warn('localStorage load failed, using initial data', e);
    }
    appData = JSON.parse(JSON.stringify(window.INITIAL_AGRI_DATA));
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
      const ind = $('save-indicator');
      if (ind) {
        ind.textContent = '✓ บันทึกแล้ว (' + new Date().toLocaleTimeString('th-TH') + ')';
      }
    } catch (e) {
      console.error('Save failed:', e);
      showToast('⚠️ พื้นที่จัดเก็บเบราว์เซอร์เต็ม แนะนำให้กดสำรองข้อมูล (.json)');
    }
  }

  // Data Lookups
  function getTambon(id) {
    return appData.tambons.find((t) => t.id === id) || appData.tambons[0];
  }

  function getVillage(tambonId, villageId) {
    const t = getTambon(tambonId);
    return t.villages.find((v) => v.id === villageId) || t.villages[0];
  }

  // Aggregation Engine: รม. -> รต. -> รอ.
  function emptyCropAgg() {
    const obj = {};
    appData.crops.forEach((c) => {
      obj[c.id] = { n: 0, s: 0, h: 0, ns: 0, ks: 0, p: 0, y: 0, _effArea: 0 };
    });
    return obj;
  }

  function computeAvgYield(agg) {
    const denom = agg._effArea > 0 ? agg._effArea : (agg.h > 0 ? agg.h : agg.s > 0 ? agg.s : agg.n > 0 ? agg.n : 0);
    if (denom > 0 && agg.p > 0) {
      return Math.round(agg.p / denom);
    }
    return 0;
  }

  function summarizeVillage(village) {
    const farmerSet = new Set();
    let totalArea = 0;
    const crops = emptyCropAgg();

    village.plots.forEach((plot) => {
      if (plot.f && plot.f.trim()) farmerSet.add(plot.f.trim());
      totalArea += Number(plot.a || 0);
      if (plot.c) {
        Object.keys(plot.c).forEach((cid) => {
          if (!crops[cid]) return;
          const cv = plot.c[cid];
          const n = Number(cv.n || 0);
          const s = Number(cv.s || 0);
          const h = Number(cv.h || 0);
          const p = Number(cv.p || 0);
          const y = Number(cv.y || 0);
          crops[cid].n += n;
          crops[cid].s += s;
          crops[cid].h += h;
          crops[cid].ns += Number(cv.ns || 0);
          crops[cid].ks += Number(cv.ks || 0);
          crops[cid].p += p;
          const eff = p > 0 && y > 0 ? p / y : Math.max(n, s, h);
          crops[cid]._effArea += eff;
        });
      }
    });

    Object.keys(crops).forEach((cid) => {
      crops[cid].n = round4(crops[cid].n);
      crops[cid].s = round4(crops[cid].s);
      crops[cid].h = round4(crops[cid].h);
      crops[cid].ns = round4(crops[cid].ns);
      crops[cid].ks = round4(crops[cid].ks);
      crops[cid].p = round4(crops[cid].p);
      crops[cid].y = computeAvgYield(crops[cid]);
    });

    return {
      farmersCount: farmerSet.size,
      plotsCount: village.plots.length,
      totalArea: round4(totalArea),
      crops,
    };
  }

  function summarizeTambon(tambon) {
    let farmersCount = 0;
    let plotsCount = 0;
    let totalArea = 0;
    const crops = emptyCropAgg();

    const villageSummaries = tambon.villages.map((v) => {
      const vs = summarizeVillage(v);
      farmersCount += vs.farmersCount;
      plotsCount += vs.plotsCount;
      totalArea += vs.totalArea;
      Object.keys(crops).forEach((cid) => {
        crops[cid].n += vs.crops[cid].n;
        crops[cid].s += vs.crops[cid].s;
        crops[cid].h += vs.crops[cid].h;
        crops[cid].ns += vs.crops[cid].ns;
        crops[cid].ks += vs.crops[cid].ks;
        crops[cid].p += vs.crops[cid].p;
        crops[cid]._effArea += vs.crops[cid]._effArea;
      });
      return { village: v, summary: vs };
    });

    Object.keys(crops).forEach((cid) => {
      crops[cid].n = round4(crops[cid].n);
      crops[cid].s = round4(crops[cid].s);
      crops[cid].h = round4(crops[cid].h);
      crops[cid].ns = round4(crops[cid].ns);
      crops[cid].ks = round4(crops[cid].ks);
      crops[cid].p = round4(crops[cid].p);
      crops[cid].y = computeAvgYield(crops[cid]);
    });

    return {
      farmersCount,
      plotsCount,
      totalArea: round4(totalArea),
      crops,
      villageSummaries,
    };
  }

  function summarizeDistrict() {
    let farmersCount = 0;
    let plotsCount = 0;
    let totalArea = 0;
    const crops = emptyCropAgg();

    const tambonSummaries = appData.tambons.map((t) => {
      const ts = summarizeTambon(t);
      farmersCount += ts.farmersCount;
      plotsCount += ts.plotsCount;
      totalArea += ts.totalArea;
      Object.keys(crops).forEach((cid) => {
        crops[cid].n += ts.crops[cid].n;
        crops[cid].s += ts.crops[cid].s;
        crops[cid].h += ts.crops[cid].h;
        crops[cid].ns += ts.crops[cid].ns;
        crops[cid].ks += ts.crops[cid].ks;
        crops[cid].p += ts.crops[cid].p;
        crops[cid]._effArea += ts.crops[cid]._effArea;
      });
      return { tambon: t, summary: ts };
    });

    Object.keys(crops).forEach((cid) => {
      crops[cid].n = round4(crops[cid].n);
      crops[cid].s = round4(crops[cid].s);
      crops[cid].h = round4(crops[cid].h);
      crops[cid].ns = round4(crops[cid].ns);
      crops[cid].ks = round4(crops[cid].ks);
      crops[cid].p = round4(crops[cid].p);
      crops[cid].y = computeAvgYield(crops[cid]);
    });

    return {
      farmersCount,
      plotsCount,
      totalArea: round4(totalArea),
      crops,
      tambonSummaries,
    };
  }

  function getVisibleCrops(cropsAgg) {
    if (state.showAllCrops) return appData.crops;
    const active = appData.crops.filter((c) => {
      const a = cropsAgg[c.id];
      return a && (a.n > 0 || a.s > 0 || a.h > 0 || a.p > 0);
    });
    return active.length > 0 ? active : [appData.crops[0]];
  }

  // Update KPI Cards
  function updateKPIs(summary) {
    $('kpi-farmers').textContent = fmtNumZero(summary.farmersCount, 0);
    $('kpi-plots').textContent = fmtNumZero(summary.plotsCount, 0);
    $('kpi-area').textContent = fmtNumZero(summary.totalArea, 2);
    $('kpi-rice-prod').textContent = fmtNumZero(summary.crops.rice.p, 0);
    let otherArea = 0;
    appData.crops.forEach((c) => {
      if (c.id !== 'rice') {
        const a = summary.crops[c.id];
        otherArea += (a.n || 0) + (a.s || 0) + (a.h || 0);
      }
    });
    $('kpi-other-area').textContent = fmtNumZero(otherArea, 2);
  }

  function updateHeaderDate() {
    const m = appData.meta;
    $('topbar-date-info').textContent = `ข้อมูล ณ วันที่ ${m.reportDay} ${m.reportMonth} พ.ศ. ${m.reportYear} • เชื่อมโยง รม. → รต. → รอ. อัตโนมัติ`;
  }

  // Render Crop Headers (Shared across รอ. / รต. / รม.)
  function renderCropTableHeaders(visibleCrops) {
    let row1 = '';
    let row2 = '';
    visibleCrops.forEach((crop, idx) => {
      const span = crop.hasCassavaSplit ? 7 : 5;
      const alt = idx % 2 === 1 ? ' alt' : '';
      const varietyTxt = crop.variety ? `/พันธุ์ ${crop.variety}` : '';
      row1 += `<th colspan="${span}" class="crop-header${alt}">${crop.num}. ${escHtml(crop.name)}${escHtml(varietyTxt)}</th>`;
      if (crop.hasCassavaSplit) {
        row2 += `<th>ปลูกใหม่<br>(ไร่)</th><th>ยืนต้น<br>(ไร่)</th><th>เก็บเกี่ยว<br>(ไร่)</th><th>ไม่เก็บท่อนพันธุ์<br>(ไร่)</th><th>เก็บท่อนพันธุ์<br>(ไร่)</th><th>ผลผลิตรวม<br>(กก.)</th><th>เฉลี่ย<br>(กก./ไร่)</th>`;
      } else {
        row2 += `<th>ปลูกใหม่<br>(ไร่)</th><th>ยืนต้น<br>(ไร่)</th><th>เก็บเกี่ยว<br>(ไร่)</th><th>ผลผลิตรวม<br>(กก.)</th><th>เฉลี่ย<br>(กก./ไร่)</th>`;
      }
    });
    return { row1, row2 };
  }

  function renderCropCells(cropsObj, visibleCrops) {
    let html = '';
    visibleCrops.forEach((crop) => {
      const cv = (cropsObj && cropsObj[crop.id]) || {};
      if (crop.hasCassavaSplit) {
        html += `<td class="num">${fmtNum(cv.n)}</td>`;
        html += `<td class="num">${fmtNum(cv.s)}</td>`;
        html += `<td class="num">${fmtNum(cv.h)}</td>`;
        html += `<td class="num">${fmtNum(cv.ns)}</td>`;
        html += `<td class="num">${fmtNum(cv.ks)}</td>`;
        html += `<td class="num">${fmtNum(cv.p, 0)}</td>`;
        html += `<td class="num">${fmtNum(cv.y, 0)}</td>`;
      } else {
        html += `<td class="num">${fmtNum(cv.n)}</td>`;
        html += `<td class="num">${fmtNum(cv.s)}</td>`;
        html += `<td class="num">${fmtNum(cv.h)}</td>`;
        html += `<td class="num">${fmtNum(cv.p, 0)}</td>`;
        html += `<td class="num">${fmtNum(cv.y, 0)}</td>`;
      }
    });
    return html;
  }

  // ========================
  // VIEW 0: DASHBOARD (แดชบอร์ดภาพรวม)
  // ========================
  function destroyDashCharts() {
    dashCharts.forEach((ch) => {
      try {
        ch.destroy();
      } catch (e) {}
    });
    dashCharts = [];
  }

  function renderDashboard() {
    destroyDashCharts();
    const isDistrict = state.dashScope === 'all';
    const dist = summarizeDistrict();
    const activeTambon = isDistrict ? null : getTambon(state.dashScope);
    const activeSummary = isDistrict ? dist : summarizeTambon(activeTambon);
    updateKPIs(activeSummary);

    // Toolbar
    const scopeOptions =
      `<option value="all" ${isDistrict ? 'selected' : ''}>ภาพรวมทั้งอำเภอสีดา (5 ตำบล / 50 หมู่บ้าน)</option>` +
      appData.tambons
        .map((t) => `<option value="${t.id}" ${state.dashScope === t.id ? 'selected' : ''}>ตำบล${escHtml(t.name)} (${t.villages.length} หมู่บ้าน)</option>`)
        .join('');

    $('toolbar').innerHTML = `
      <div class="toolbar-group">
        <label>ขอบเขตแดชบอร์ด:</label>
        <select id="sel-dash-scope">${scopeOptions}</select>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-primary btn-sm" id="btn-dash-add">+ เพิ่มเกษตรกร / แปลง (รม.)</button>
        <button class="btn btn-secondary btn-sm" id="btn-dash-present">🖥️ โหมดนำเสนอ</button>
        <button class="btn btn-outline btn-sm" id="btn-dash-goto-ro">🏛️ เปิดแบบ รอ.</button>
        <button class="btn btn-outline btn-sm" id="btn-dash-print">🖨️ พิมพ์แดชบอร์ด</button>
      </div>
    `;

    // Executive Summary & Easy-to-understand Narrative
    const m = appData.meta;
    const scopeTitle = isDistrict
      ? `อำเภอ${m.district} จังหวัด${m.province} (${appData.tambons.length} ตำบล / ${appData.tambons.reduce((a, t) => a + t.villages.length, 0)} หมู่บ้าน)`
      : `ตำบล${activeTambon.name} อำเภอ${m.district} (${activeTambon.villages.length} หมู่บ้าน)`;

    const avgAreaPerFarmer = activeSummary.farmersCount > 0 ? activeSummary.totalArea / activeSummary.farmersCount : 0;
    const avgPlotsPerFarmer = activeSummary.farmersCount > 0 ? activeSummary.plotsCount / activeSummary.farmersCount : 0;

    const rice = activeSummary.crops.rice;
    const riceTotalArea = round4((rice.n || 0) + (rice.s || 0) + (rice.h || 0));
    const riceHarvestPct = riceTotalArea > 0 ? Math.round((rice.h / riceTotalArea) * 1000) / 10 : 0;
    const riceStandingPct = riceTotalArea > 0 ? Math.round((rice.s / riceTotalArea) * 1000) / 10 : 0;
    const riceNewPct = riceTotalArea > 0 ? Math.max(0, Math.round((100 - riceHarvestPct - riceStandingPct) * 10) / 10) : 0;
    const riceTons = rice.p / 1000;

    // Identify secondary crops with data
    const otherCropsList = appData.crops
      .filter((c) => c.id !== 'rice')
      .map((c) => {
        const a = activeSummary.crops[c.id];
        const area = round4((a.n || 0) + (a.s || 0) + (a.h || 0));
        return { crop: c, area, prod: a.p || 0, tons: (a.p || 0) / 1000 };
      })
      .filter((x) => x.area > 0 || x.prod > 0);

    const otherCropsSummaryText =
      otherCropsList.length > 0
        ? otherCropsList.map((x) => `${x.crop.name} ${fmtNumZero(x.area, 2)} ไร่ (${fmtNumZero(x.tons, 1)} ตัน)`).join(', ')
        : 'ยังไม่พบการรายงานพืชรองอื่นในพื้นที่นี้';

    // Top sub-unit (Tambon or Village)
    let topUnitName = '-';
    let topUnitArea = 0;
    let topUnitPct = 0;
    if (isDistrict && dist.tambonSummaries.length > 0) {
      const sortedT = [...dist.tambonSummaries].sort((a, b) => b.summary.totalArea - a.summary.totalArea);
      topUnitName = `ตำบล${sortedT[0].tambon.name}`;
      topUnitArea = sortedT[0].summary.totalArea;
      topUnitPct = dist.totalArea > 0 ? Math.round((topUnitArea / dist.totalArea) * 1000) / 10 : 0;
    } else if (!isDistrict && activeSummary.villageSummaries.length > 0) {
      const sortedV = [...activeSummary.villageSummaries].sort((a, b) => b.summary.totalArea - a.summary.totalArea);
      topUnitName = `หมู่ ${sortedV[0].village.moo} บ้าน${sortedV[0].village.name}`;
      topUnitArea = sortedV[0].summary.totalArea;
      topUnitPct = activeSummary.totalArea > 0 ? Math.round((topUnitArea / activeSummary.totalArea) * 1000) / 10 : 0;
    }

    const totalAllCropArea = appData.crops.reduce((acc, c) => {
      const a = activeSummary.crops[c.id];
      return acc + (a.n || 0) + (a.s || 0) + (a.h || 0);
    }, 0);
    const riceSharePct = totalAllCropArea > 0 ? Math.round((riceTotalArea / totalAllCropArea) * 1000) / 10 : 0;

    const plainReportText = [
      `📊 สรุปภาพรวมข้อมูลการผลิตด้านพืช ${scopeTitle}`,
      `ข้อมูล ณ วันที่ ${m.reportDay} ${m.reportMonth} พ.ศ. ${m.reportYear}`,
      `• เกษตรกรทั้งหมด: ${fmtNumZero(activeSummary.farmersCount, 0)} ครัวเรือน (${fmtNumZero(activeSummary.plotsCount, 0)} แปลง)`,
      `• พื้นที่การเกษตรรวม: ${fmtNumZero(activeSummary.totalArea, 2)} ไร่ (เฉลี่ย ${fmtNumZero(avgAreaPerFarmer, 2)} ไร่/ครัวเรือน)`,
      `• พื้นที่มากที่สุด: ${topUnitName} (${fmtNumZero(topUnitArea, 2)} ไร่ หรือ ${topUnitPct}%)`,
      `• พืชหลัก (ข้าว มะลิ 105): ${fmtNumZero(riceTotalArea, 2)} ไร่ (${riceSharePct}%) — ยืนต้น ${fmtNumZero(rice.s, 0)} ไร่ (${riceStandingPct}%), เก็บเกี่ยวแล้ว ${fmtNumZero(rice.h, 0)} ไร่ (${riceHarvestPct}%)`,
      `• คาดการณ์ผลผลิตข้าวรวม: ${fmtNumZero(riceTons, 2)} ตัน (${fmtNumZero(rice.p, 0)} กก. | เฉลี่ย ${fmtNumZero(rice.y, 0)} กก./ไร่)`,
      `• พืชเศรษฐกิจอื่นๆ: ${otherCropsSummaryText}`,
    ].join('\n');

    const execSummaryHtml = `
      <div class="present-exit-bar no-print">
        <div>🖥️ <strong>โหมดนำเสนอข้อมูลภาพรวม</strong> — ${escHtml(scopeTitle)} (ณ วันที่ ${escHtml(m.reportDay)} ${escHtml(m.reportMonth)} ${escHtml(m.reportYear)})</div>
        <button class="btn btn-sm btn-primary" id="btn-exit-present">✕ ออกจากโหมดนำเสนอ</button>
      </div>
      <div class="exec-summary-card">
        <div class="exec-header">
          <div>
            <div class="exec-title">📋 บทสรุปและนำเสนอภาพรวมการผลิตด้านพืช — ${escHtml(scopeTitle)}</div>
            <div class="exec-subtitle">ข้อมูล ณ วันที่ ${escHtml(m.reportDay)} ${escHtml(m.reportMonth)} พ.ศ. ${escHtml(m.reportYear)} • สรุปประเด็นสำคัญเพื่อการรายงานและนำเสนอ</div>
          </div>
          <div class="no-print" style="display:flex;gap:8px;">
            <button class="btn btn-outline btn-sm" id="btn-copy-summary">📋 คัดลอกบทสรุปรายงาน</button>
          </div>
        </div>
        <div class="exec-narrative">
          ภาพรวมการผลิตด้านพืชของ <strong>${escHtml(scopeTitle)}</strong> มีเกษตรกรขึ้นทะเบียนรวม <strong>${fmtNumZero(activeSummary.farmersCount, 0)} ครัวเรือน</strong>
          (${fmtNumZero(activeSummary.plotsCount, 0)} แปลง) ครอบคลุมพื้นที่การเกษตรทั้งหมด <strong>${fmtNumZero(activeSummary.totalArea, 2)} ไร่</strong>
          โดยมี <strong>${escHtml(topUnitName)}</strong> เป็นพื้นที่เพาะปลูกขนาดใหญ่ที่สุด (${fmtNumZero(topUnitArea, 2)} ไร่ คิดเป็น ${topUnitPct}%)
          พืชเศรษฐกิจหลักคือ <strong>ข้าว (พันธุ์มะลิ 105)</strong> คิดเป็นสัดส่วน <strong>${riceSharePct}%</strong> ของพื้นที่เพาะปลูกทั้งหมด
          คาดการณ์ผลผลิตข้าวรวม <strong>${fmtNumZero(riceTons, 2)} ตัน</strong> (${fmtNumZero(rice.p, 0)} กก. เฉลี่ย ${fmtNumZero(rice.y, 0)} กก./ไร่)
          ปัจจุบันเก็บเกี่ยวแล้ว <strong>${riceHarvestPct}%</strong> และอยู่ระหว่างยืนต้น <strong>${riceStandingPct}%</strong>
          ${otherCropsList.length > 0 ? `นอกจากนี้ยังมีพืชเศรษฐกิจรอง ได้แก่ <strong>${escHtml(otherCropsSummaryText)}</strong>` : ''}
        </div>
        <div class="insights-grid">
          <div class="insight-box">
            <div class="insight-label">🏅 พื้นที่เพาะปลูกมากที่สุด</div>
            <div class="insight-value">${escHtml(topUnitName)}</div>
            <div class="insight-desc">${fmtNumZero(topUnitArea, 2)} ไร่ (คิดเป็น ${topUnitPct}% ของพื้นที่ทั้งหมด)</div>
          </div>
          <div class="insight-box">
            <div class="insight-label">🌾 สถานะพื้นที่ข้าว (ยืนต้น vs เก็บเกี่ยว)</div>
            <div class="insight-value">เก็บเกี่ยวแล้ว ${riceHarvestPct}%</div>
            <div class="insight-desc">ยืนต้น ${fmtNumZero(rice.s, 0)} ไร่ (${riceStandingPct}%) • เก็บเกี่ยว ${fmtNumZero(rice.h, 0)} ไร่</div>
            <div class="progress-track" title="ฟ้า=เก็บเกี่ยว, เขียว=ยืนต้น, ส้ม=ปลูกใหม่">
              <div class="progress-seg-harvest" style="width:${riceHarvestPct}%"></div>
              <div class="progress-seg-standing" style="width:${riceStandingPct}%"></div>
              <div class="progress-seg-new" style="width:${riceNewPct}%"></div>
            </div>
          </div>
          <div class="insight-box">
            <div class="insight-label">📐 ขนาดพื้นที่เฉลี่ยต่อครัวเรือน</div>
            <div class="insight-value">${fmtNumZero(avgAreaPerFarmer, 2)} ไร่ / ราย</div>
            <div class="insight-desc">เฉลี่ยถือครอง ${fmtNumZero(avgPlotsPerFarmer, 2)} แปลงต่อครัวเรือน</div>
          </div>
          <div class="insight-box">
            <div class="insight-label">🌱 พืชเศรษฐกิจรองในพื้นที่</div>
            <div class="insight-value">${otherCropsList.length} ชนิดพืช</div>
            <div class="insight-desc">${escHtml(otherCropsSummaryText)}</div>
          </div>
        </div>
      </div>
    `;

    // Build Tambon / Village Quick Cards
    let cardsSectionHtml = '';
    if (isDistrict) {
      const miniCards = dist.tambonSummaries
        .map(
          (item) => `
          <div class="tambon-mini-card" data-dash-tambon="${item.tambon.id}">
            <div class="tambon-mini-title">ตำบล${escHtml(item.tambon.name)} (${item.tambon.villages.length} หมู่)</div>
            <div class="tambon-mini-stat"><span>ครัวเรือน</span><strong>${fmtNumZero(item.summary.farmersCount, 0)} ราย</strong></div>
            <div class="tambon-mini-stat"><span>พื้นที่เกษตร</span><strong>${fmtNumZero(item.summary.totalArea, 2)} ไร่</strong></div>
            <div class="tambon-mini-stat"><span>ผลผลิตข้าว</span><strong>${fmtNumZero(item.summary.crops.rice.p / 1000, 1)} ตัน</strong></div>
          </div>`
        )
        .join('');
      cardsSectionHtml = `
        <div class="dash-card">
          <div class="dash-card-header">
            <div class="dash-card-title">🏘️ สรุปข้อมูลรายตำบล อำเภอสีดา (คลิกเพื่อดูรายละเอียด)</div>
            <div class="dash-card-sub">อัปเดตอัตโนมัติจากแบบ รม. ทุกหมู่บ้าน</div>
          </div>
          <div class="tambon-cards-grid">${miniCards}</div>
        </div>
      `;
    }

    // Crop Summary Table
    const cropRows = appData.crops
      .map((crop) => {
        const a = activeSummary.crops[crop.id];
        const totalCropArea = round4((a.n || 0) + (a.s || 0) + (a.h || 0));
        const hasData = totalCropArea > 0 || a.p > 0;
        return `
          <tr style="${hasData ? '' : 'opacity:0.48;'}">
            <td><strong>${crop.num}. ${escHtml(crop.name)}</strong>${crop.variety ? ` <span style="color:#64748b;font-size:12px;">(${escHtml(crop.variety)})</span>` : ''}</td>
            <td class="num">${fmtNumZero(a.n, 2)}</td>
            <td class="num">${fmtNumZero(a.s, 2)}</td>
            <td class="num">${fmtNumZero(a.h, 2)}</td>
            <td class="num"><strong>${fmtNumZero(a.p, 0)}</strong></td>
            <td class="num">${fmtNumZero(a.p / 1000, 2)}</td>
            <td class="num">${fmtNumZero(a.y, 0)}</td>
          </tr>
        `;
      })
      .join('');

    // Top 10 Villages by Area
    const allVillages = [];
    const targetTambons = isDistrict ? appData.tambons : [activeTambon];
    targetTambons.forEach((t) => {
      t.villages.forEach((v) => {
        const vs = summarizeVillage(v);
        allVillages.push({ tambon: t, village: v, summary: vs });
      });
    });
    allVillages.sort((a, b) => b.summary.totalArea - a.summary.totalArea);
    const topVillages = allVillages.slice(0, 10);
    const maxArea = topVillages.length > 0 ? Math.max(1, topVillages[0].summary.totalArea) : 1;

    const topRankHtml = topVillages
      .map((item, idx) => {
        const pct = Math.min(100, Math.round((item.summary.totalArea / maxArea) * 100));
        return `
          <div class="rank-item" data-rank-tambon="${item.tambon.id}" data-rank-village="${item.village.id}" title="คลิกเพื่อเปิดแบบ รม. หมู่บ้านนี้">
            <div class="rank-top">
              <span class="rank-name">${idx + 1}. บ้าน${escHtml(item.village.name)} (ม.${item.village.moo} ต.${escHtml(item.tambon.name)})</span>
              <span class="rank-meta"><strong>${fmtNumZero(item.summary.totalArea, 2)} ไร่</strong> • ${fmtNumZero(item.summary.farmersCount, 0)} ราย</span>
            </div>
            <div class="rank-bar-bg"><div class="rank-bar-fill" style="width:${pct}%"></div></div>
          </div>
        `;
      })
      .join('');

    const barTitle = isDistrict
      ? '📊 เปรียบเทียบพื้นที่การเกษตร (ไร่) และผลผลิตข้าว (ตัน) แยกรายตำบล'
      : `📊 เปรียบเทียบพื้นที่การเกษตร (ไร่) และผลผลิตข้าว (ตัน) ตำบล${escHtml(activeTambon.name)}`;

    $('dashboard-view').innerHTML = `
      ${execSummaryHtml}
      ${cardsSectionHtml}
      <div class="dash-row-2">
        <div class="dash-card">
          <div class="dash-card-header">
            <div class="dash-card-title">${barTitle}</div>
            <div class="dash-card-sub">หน่วย: ไร่ / ตัน</div>
          </div>
          <div class="chart-box"><canvas id="chart-bar-main"></canvas></div>
        </div>
        <div class="dash-card">
          <div class="dash-card-header">
            <div class="dash-card-title">🌾 สัดส่วนสถานะพื้นที่ข้าว (ไร่)</div>
            <div class="dash-card-sub">ปลูกใหม่ • ยืนต้น • เก็บเกี่ยว</div>
          </div>
          <div class="chart-box-sm"><canvas id="chart-doughnut-rice"></canvas></div>
        </div>
      </div>

      <div class="dash-row-equal">
        <div class="dash-card">
          <div class="dash-card-header">
            <div class="dash-card-title">🌱 สรุปผลผลิตแยกตามชนิดพืชทั้ง 10 ชนิด</div>
            <div class="dash-card-sub">${isDistrict ? 'อำเภอสีดา' : 'ตำบล' + escHtml(activeTambon.name)}</div>
          </div>
          <div style="overflow-x:auto;">
            <table class="dash-table">
              <thead>
                <tr>
                  <th>ชนิดพืช</th>
                  <th class="num">ปลูกใหม่ (ไร่)</th>
                  <th class="num">ยืนต้น (ไร่)</th>
                  <th class="num">เก็บเกี่ยว (ไร่)</th>
                  <th class="num">ผลผลิต (กก.)</th>
                  <th class="num">ผลผลิต (ตัน)</th>
                  <th class="num">เฉลี่ย (กก./ไร่)</th>
                </tr>
              </thead>
              <tbody>${cropRows}</tbody>
            </table>
          </div>
        </div>
        <div class="dash-card">
          <div class="dash-card-header">
            <div class="dash-card-title">🏆 อันดับหมู่บ้านพื้นที่การเกษตรสูงสุด (Top ${topVillages.length})</div>
            <div class="dash-card-sub">คลิกที่หมู่บ้านเพื่อแก้ไขแบบ รม.</div>
          </div>
          <div class="rank-list">${topRankHtml}</div>
        </div>
      </div>
    `;

    // Render Chart.js graphs
    if (typeof Chart !== 'undefined') {
      Chart.defaults.font.family = "'Sarabun', sans-serif";

      const labels = isDistrict
        ? dist.tambonSummaries.map((x) => 'ต.' + x.tambon.name)
        : activeSummary.villageSummaries.map((x) => `ม.${x.village.moo} ${x.village.name}`);
      const areaData = isDistrict
        ? dist.tambonSummaries.map((x) => round4(x.summary.totalArea))
        : activeSummary.villageSummaries.map((x) => round4(x.summary.totalArea));
      const riceTonsData = isDistrict
        ? dist.tambonSummaries.map((x) => Math.round(x.summary.crops.rice.p / 1000))
        : activeSummary.villageSummaries.map((x) => Math.round(x.summary.crops.rice.p / 1000));

      const barCtx = $('chart-bar-main').getContext('2d');
      dashCharts.push(
        new Chart(barCtx, {
          type: 'bar',
          data: {
            labels,
            datasets: [
              {
                label: 'พื้นที่การเกษตร (ไร่)',
                data: areaData,
                backgroundColor: 'rgba(21, 128, 61, 0.82)',
                borderRadius: 6,
              },
              {
                label: 'ผลผลิตข้าว (ตัน)',
                data: riceTonsData,
                backgroundColor: 'rgba(14, 116, 144, 0.78)',
                borderRadius: 6,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'top' },
            },
            scales: {
              y: { beginAtZero: true },
            },
          },
        })
      );

      const doughCtx = $('chart-doughnut-rice').getContext('2d');
      dashCharts.push(
        new Chart(doughCtx, {
          type: 'doughnut',
          data: {
            labels: ['พื้นที่ปลูกใหม่ (ไร่)', 'พื้นที่ยืนต้น (ไร่)', 'พื้นที่เก็บเกี่ยว (ไร่)'],
            datasets: [
              {
                data: [rice.n || 0, rice.s || 0, rice.h || 0],
                backgroundColor: ['#f59e0b', '#16a34a', '#0ea5e9'],
                borderWidth: 2,
                borderColor: '#ffffff',
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '58%',
            plugins: {
              legend: { position: 'bottom' },
            },
          },
        })
      );
    }

    // Bind Dashboard events
    $('sel-dash-scope').addEventListener('change', (e) => {
      state.dashScope = e.target.value;
      render();
    });
    $('btn-dash-add').addEventListener('click', () => {
      if (!isDistrict) {
        state.tambonId = state.dashScope;
        state.villageId = getTambon(state.tambonId).villages[0].id;
      }
      openPlotModal(-1);
    });
    $('btn-dash-goto-ro').addEventListener('click', () => switchView('ro'));
    $('btn-dash-print').addEventListener('click', () => window.print());
    $('btn-dash-present').addEventListener('click', () => {
      document.body.classList.add('present-mode');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    const exitPresentBtn = $('btn-exit-present');
    if (exitPresentBtn) {
      exitPresentBtn.addEventListener('click', () => {
        document.body.classList.remove('present-mode');
      });
    }
    const copyBtn = $('btn-copy-summary');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(plainReportText).then(() => {
            showToast('📋 คัดลอกบทสรุปรายงานแล้ว! นำไปวางใน LINE หรือ Word ได้เลย');
          });
        } else {
          prompt('คัดลอกข้อความสรุปรายงานด้านล่าง:', plainReportText);
        }
      });
    }

    document.querySelectorAll('[data-dash-tambon]').forEach((card) => {
      card.addEventListener('click', () => {
        state.dashScope = card.dataset.dashTambon;
        render();
      });
    });

    document.querySelectorAll('[data-rank-village]').forEach((item) => {
      item.addEventListener('click', () => {
        state.tambonId = item.dataset.rankTambon;
        state.villageId = item.dataset.rankVillage;
        state.page = 1;
        state.search = '';
        switchView('rm');
      });
    });
  }

  // ========================
  // VIEW 1: รอ. (รายอำเภอ)
  // ========================
  function renderViewRO() {
    const dist = summarizeDistrict();
    updateKPIs(dist);
    const visibleCrops = getVisibleCrops(dist.crops);
    const m = appData.meta;

    // Toolbar
    $('toolbar').innerHTML = `
      <div class="toolbar-group">
        <label><input type="checkbox" id="chk-all-crops" ${state.showAllCrops ? 'checked' : ''} /> แสดงครบทั้ง 10 ชนิดพืช (ฟอร์มเต็ม)</label>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-primary btn-sm" id="btn-quick-add">+ เพิ่มข้อมูลเกษตรกร (รม.)</button>
        <button class="btn btn-secondary btn-sm" id="btn-export-current">📥 โหลด Excel แบบ รอ.</button>
        <button class="btn btn-outline btn-sm" id="btn-print">🖨️ พิมพ์ฟอร์ม รอ.</button>
      </div>
    `;

    // Official Header
    $('official-header').innerHTML = `
      <h2>แบบจัดเก็บข้อมูลการผลิตทางการเกษตรด้านพืชรายอำเภอ ${escHtml(m.district)} จังหวัด${escHtml(m.province)} (รอ.)</h2>
      <p>ข้อมูล ณ วันที่ ${escHtml(m.reportDay)} เดือน ${escHtml(m.reportMonth)} พ.ศ. ${escHtml(m.reportYear)}</p>
    `;

    const headers = renderCropTableHeaders(visibleCrops);
    let bodyRows = '';
    dist.tambonSummaries.forEach((item, i) => {
      bodyRows += `
        <tr>
          <td class="center">${i + 1}</td>
          <td class="link-cell" data-goto-tambon="${item.tambon.id}" title="คลิกเพื่อดูแบบ รต. ตำบล${escHtml(item.tambon.name)}">${escHtml(item.tambon.name)}</td>
          <td class="num">${fmtNumZero(item.summary.farmersCount, 0)}</td>
          <td class="num">${fmtNumZero(item.summary.totalArea, 2)}</td>
          ${renderCropCells(item.summary.crops, visibleCrops)}
        </tr>
      `;
    });

    const totalRow = `
      <tr class="total-row">
        <td class="center" colspan="2">รวมทั้งหมด (${dist.tambonSummaries.length} ตำบล)</td>
        <td class="num">${fmtNumZero(dist.farmersCount, 0)}</td>
        <td class="num">${fmtNumZero(dist.totalArea, 2)}</td>
        ${renderCropCells(dist.crops, visibleCrops)}
      </tr>
    `;

    $('table-wrapper').innerHTML = `
      <table class="agri-table">
        <thead>
          <tr>
            <th rowspan="2">ที่</th>
            <th rowspan="2">ตำบล (คลิกเพื่อดู รต.)</th>
            <th rowspan="2">ครัวเรือน<br>เกษตรกร (ราย)</th>
            <th rowspan="2">พื้นที่การเกษตร<br>(ไร่)</th>
            ${headers.row1}
          </tr>
          <tr>${headers.row2}</tr>
        </thead>
        <tbody>
          ${bodyRows}
          ${totalRow}
        </tbody>
      </table>
    `;

    $('pagination-bar').hidden = true;

    $('official-footer').innerHTML = `
      <div class="sign-block">
        <div>ลงชื่อ ............................................................</div>
        <div>(${escHtml(m.districtOfficer)})</div>
        <div>ตำแหน่ง ${escHtml(m.districtPosition)}</div>
      </div>
    `;

    // Bind events
    $('chk-all-crops').addEventListener('change', (e) => {
      state.showAllCrops = e.target.checked;
      render();
    });
    $('btn-quick-add').addEventListener('click', () => openPlotModal(-1));
    $('btn-export-current').addEventListener('click', () => exportROExcel());
    $('btn-print').addEventListener('click', () => window.print());
    document.querySelectorAll('[data-goto-tambon]').forEach((el) => {
      el.addEventListener('click', () => {
        state.tambonId = el.dataset.gotoTambon;
        const t = getTambon(state.tambonId);
        state.villageId = t.villages[0].id;
        switchView('rt');
      });
    });
  }

  // ========================
  // VIEW 2: รต. (รายตำบล)
  // ========================
  function renderViewRT() {
    const tambon = getTambon(state.tambonId);
    const ts = summarizeTambon(tambon);
    updateKPIs(ts);
    const visibleCrops = getVisibleCrops(ts.crops);
    const m = appData.meta;

    const tambonOptions = appData.tambons
      .map((t) => `<option value="${t.id}" ${t.id === tambon.id ? 'selected' : ''}>ตำบล${escHtml(t.name)} (${t.villages.length} หมู่บ้าน)</option>`)
      .join('');

    $('toolbar').innerHTML = `
      <div class="toolbar-group">
        <label>เลือกตำบล:</label>
        <select id="sel-rt-tambon">${tambonOptions}</select>
      </div>
      <div class="toolbar-group">
        <label><input type="checkbox" id="chk-all-crops" ${state.showAllCrops ? 'checked' : ''} /> แสดงครบทั้ง 10 ชนิดพืช</label>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-primary btn-sm" id="btn-quick-add">+ เพิ่มข้อมูลเกษตรกร (รม.)</button>
        <button class="btn btn-secondary btn-sm" id="btn-export-current">📥 โหลด Excel แบบ รต.</button>
        <button class="btn btn-outline btn-sm" id="btn-print">🖨️ พิมพ์ฟอร์ม รต.</button>
      </div>
    `;

    $('official-header').innerHTML = `
      <h2>แบบจัดเก็บข้อมูลการผลิตทางการเกษตรด้านพืชรายตำบล ${escHtml(tambon.name)} อำเภอ${escHtml(m.district)} จังหวัด${escHtml(m.province)} (รต.)</h2>
      <p>ข้อมูล ณ วันที่ ${escHtml(m.reportDay)} เดือน ${escHtml(m.reportMonth)} พ.ศ. ${escHtml(m.reportYear)}</p>
    `;

    const headers = renderCropTableHeaders(visibleCrops);
    let bodyRows = '';
    ts.villageSummaries.forEach((item) => {
      bodyRows += `
        <tr>
          <td class="center">${item.village.moo}</td>
          <td class="link-cell" data-goto-village="${item.village.id}" title="คลิกเพื่อดู/แก้ไขแบบ รม. บ้าน${escHtml(item.village.name)}">${escHtml(item.village.name)}</td>
          <td class="num">${fmtNumZero(item.summary.farmersCount, 0)}</td>
          <td class="num">${fmtNumZero(item.summary.totalArea, 2)}</td>
          ${renderCropCells(item.summary.crops, visibleCrops)}
        </tr>
      `;
    });

    const totalRow = `
      <tr class="total-row">
        <td class="center" colspan="2">รวมตำบล${escHtml(tambon.name)} (${ts.villageSummaries.length} หมู่บ้าน)</td>
        <td class="num">${fmtNumZero(ts.farmersCount, 0)}</td>
        <td class="num">${fmtNumZero(ts.totalArea, 2)}</td>
        ${renderCropCells(ts.crops, visibleCrops)}
      </tr>
    `;

    $('table-wrapper').innerHTML = `
      <table class="agri-table">
        <thead>
          <tr>
            <th rowspan="2">หมู่ที่</th>
            <th rowspan="2">ชื่อหมู่บ้าน (คลิกเพื่อดู รม.)</th>
            <th rowspan="2">ครัวเรือน<br>เกษตรกร (ราย)</th>
            <th rowspan="2">พื้นที่การเกษตร<br>(ไร่)</th>
            ${headers.row1}
          </tr>
          <tr>${headers.row2}</tr>
        </thead>
        <tbody>
          ${bodyRows}
          ${totalRow}
        </tbody>
      </table>
    `;

    $('pagination-bar').hidden = true;

    $('official-footer').innerHTML = `
      <div class="sign-block">
        <div>ลงชื่อ ............................................................</div>
        <div>(${escHtml(m.districtOfficer)})</div>
        <div>ตำแหน่ง ${escHtml(m.districtPosition)}</div>
      </div>
    `;

    $('sel-rt-tambon').addEventListener('change', (e) => {
      state.tambonId = e.target.value;
      const t = getTambon(state.tambonId);
      state.villageId = t.villages[0].id;
      render();
    });
    $('chk-all-crops').addEventListener('change', (e) => {
      state.showAllCrops = e.target.checked;
      render();
    });
    $('btn-quick-add').addEventListener('click', () => openPlotModal(-1));
    $('btn-export-current').addEventListener('click', () => exportRTExcel(tambon));
    $('btn-print').addEventListener('click', () => window.print());
    document.querySelectorAll('[data-goto-village]').forEach((el) => {
      el.addEventListener('click', () => {
        state.villageId = el.dataset.gotoVillage;
        state.page = 1;
        state.search = '';
        switchView('rm');
      });
    });
  }

  // ========================
  // VIEW 3: รม. (รายหมู่บ้าน)
  // ========================
  function renderViewRM() {
    const tambon = getTambon(state.tambonId);
    const village = getVillage(state.tambonId, state.villageId);
    state.villageId = village.id;
    const vs = summarizeVillage(village);
    updateKPIs(vs);
    const visibleCrops = getVisibleCrops(vs.crops);
    const m = appData.meta;

    const tambonOptions = appData.tambons
      .map((t) => `<option value="${t.id}" ${t.id === tambon.id ? 'selected' : ''}>ต.${escHtml(t.name)}</option>`)
      .join('');
    const villageOptions = tambon.villages
      .map((v) => `<option value="${v.id}" ${v.id === village.id ? 'selected' : ''}>หมู่ ${v.moo} บ้าน${escHtml(v.name)} (${v.plots.length} แปลง)</option>`)
      .join('');
    const cropFilterOptions =
      `<option value="all" ${state.cropFilter === 'all' ? 'selected' : ''}>ทุกชนิดพืช</option>` +
      appData.crops
        .map((c) => `<option value="${c.id}" ${state.cropFilter === c.id ? 'selected' : ''}>${c.num}. ${escHtml(c.name)}</option>`)
        .join('');

    $('toolbar').innerHTML = `
      <div class="toolbar-group">
        <label>ตำบล:</label>
        <select id="sel-rm-tambon">${tambonOptions}</select>
      </div>
      <div class="toolbar-group">
        <label>หมู่บ้าน:</label>
        <select id="sel-rm-village">${villageOptions}</select>
      </div>
      <div class="toolbar-group">
        <input type="search" id="inp-rm-search" value="${escHtml(state.search)}" placeholder="🔍 ค้นหาชื่อเกษตรกร / เลขเอกสารสิทธิ์..." />
      </div>
      <div class="toolbar-group">
        <select id="sel-rm-crop-filter">${cropFilterOptions}</select>
      </div>
      <div class="toolbar-group">
        <label><input type="checkbox" id="chk-all-crops" ${state.showAllCrops ? 'checked' : ''} /> แสดงครบ 10 พืช</label>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-primary btn-sm" id="btn-add-plot">+ เพิ่มเกษตรกร / แปลง</button>
        <button class="btn btn-outline btn-sm" id="btn-rm-import-xlsx">📤 นำเข้า Excel</button>
        <button class="btn btn-secondary btn-sm" id="btn-export-current">📥 โหลด Excel แบบ รม.</button>
        <button class="btn btn-outline btn-sm" id="btn-print">🖨️ พิมพ์ฟอร์ม รม.</button>
      </div>
    `;

    $('official-header').innerHTML = `
      <h2>แบบจัดเก็บข้อมูลการผลิตทางการเกษตรด้านพืชรายหมู่บ้าน หมู่ที่ ${village.moo} บ้าน${escHtml(village.name)} ตำบล${escHtml(tambon.name)} อำเภอ${escHtml(m.district)} จังหวัด${escHtml(m.province)} (รม.)</h2>
      <p>ข้อมูล ณ วันที่ ${escHtml(m.reportDay)} เดือน ${escHtml(m.reportMonth)} พ.ศ. ${escHtml(m.reportYear)}</p>
    `;

    // Assign display farmer sequence numbers
    const indexedPlots = [];
    let farmerSeq = 0;
    let prevFarmer = null;
    village.plots.forEach((plot, origIdx) => {
      const isNewFarmer = plot.f !== prevFarmer;
      if (isNewFarmer) {
        farmerSeq++;
        prevFarmer = plot.f;
      }
      indexedPlots.push({
        origIdx,
        plot,
        seqDisplay: isNewFarmer ? farmerSeq : '',
        nameDisplay: isNewFarmer ? plot.f : '',
        isNewFarmer,
      });
    });

    // Apply search & crop filter
    const q = state.search.trim().toLowerCase();
    const filtered = indexedPlots.filter((item) => {
      if (q) {
        const matchName = (item.plot.f || '').toLowerCase().includes(q);
        const matchDoc = (item.plot.d || '').toLowerCase().includes(q);
        if (!matchName && !matchDoc) return false;
      }
      if (state.cropFilter !== 'all') {
        if (!item.plot.c || !item.plot.c[state.cropFilter]) return false;
      }
      return true;
    });

    // Pagination
    const totalFiltered = filtered.length;
    const totalPages = state.pageSize === 0 ? 1 : Math.max(1, Math.ceil(totalFiltered / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;
    const startIdx = state.pageSize === 0 ? 0 : (state.page - 1) * state.pageSize;
    const pageItems = state.pageSize === 0 ? filtered : filtered.slice(startIdx, startIdx + state.pageSize);

    const headers = renderCropTableHeaders(visibleCrops);
    let bodyRows = '';

    if (pageItems.length === 0) {
      const totalCols = 6 + visibleCrops.reduce((acc, c) => acc + (c.hasCassavaSplit ? 7 : 5), 0);
      bodyRows = `<tr><td colspan="${totalCols}" class="center" style="padding:28px;color:#64748b;">ไม่พบข้อมูลแปลงเกษตรกรที่ตรงกับเงื่อนไข</td></tr>`;
    } else {
      pageItems.forEach((item) => {
        const p = item.plot;
        const showName = q ? p.f : item.nameDisplay || `<span style="color:#94a3b8;font-size:12px;">↳ ${escHtml(p.f)}</span>`;
        bodyRows += `
          <tr>
            <td class="center">${item.seqDisplay}</td>
            <td class="farmer-name">${q ? escHtml(p.f) : item.isNewFarmer ? escHtml(p.f) : showName}</td>
            <td class="center">${p.p || 1}</td>
            <td class="center">${escHtml(p.d)}</td>
            <td class="num">${fmtNum(p.a, 2)}</td>
            ${renderCropCells(p.c, visibleCrops)}
            <td class="center no-print">
              <div class="action-btns">
                <button class="btn btn-xs btn-outline" data-add-subplot="${item.origIdx}" title="เพิ่มแปลงต่อจากเกษตรกรรายนี้">+แปลง</button>
                <button class="btn btn-xs btn-edit" data-edit-plot="${item.origIdx}">แก้ไข</button>
                <button class="btn btn-xs btn-del" data-del-plot="${item.origIdx}">ลบ</button>
              </div>
            </td>
          </tr>
        `;
      });
    }

    const totalRow = `
      <tr class="total-row">
        <td class="center" colspan="4">รวมทั้งหมด (${fmtNumZero(vs.farmersCount, 0)} ราย / ${fmtNumZero(vs.plotsCount, 0)} แปลง)</td>
        <td class="num">${fmtNumZero(vs.totalArea, 2)}</td>
        ${renderCropCells(vs.crops, visibleCrops)}
        <td class="no-print"></td>
      </tr>
    `;

    $('table-wrapper').innerHTML = `
      <table class="agri-table">
        <thead>
          <tr>
            <th rowspan="2">ลำดับที่</th>
            <th rowspan="2">ชื่อ-สกุลเกษตรกร</th>
            <th rowspan="2">แปลงที่</th>
            <th rowspan="2">เลขเอกสารสิทธิ์<br>(ถ้ามี)</th>
            <th rowspan="2">พื้นที่การเกษตร<br>(ไร่)</th>
            ${headers.row1}
            <th rowspan="2" class="no-print">จัดการ</th>
          </tr>
          <tr>${headers.row2}</tr>
        </thead>
        <tbody>
          ${bodyRows}
          ${totalRow}
        </tbody>
      </table>
    `;

    // Pagination bar
    const pBar = $('pagination-bar');
    pBar.hidden = false;
    pBar.innerHTML = `
      <div>แสดง <strong>${pageItems.length}</strong> จาก <strong>${totalFiltered}</strong> แปลง (หน้า ${state.page} / ${totalPages})</div>
      <div class="pagination-controls">
        <select id="sel-page-size" style="padding:4px 8px;border:1px solid #cbd5e1;border-radius:6px;font-family:inherit;">
          <option value="50" ${state.pageSize === 50 ? 'selected' : ''}>50 แถว/หน้า</option>
          <option value="100" ${state.pageSize === 100 ? 'selected' : ''}>100 แถว/หน้า</option>
          <option value="0" ${state.pageSize === 0 ? 'selected' : ''}>แสดงทั้งหมด</option>
        </select>
        <button class="btn btn-outline btn-xs" id="btn-prev-page" ${state.page <= 1 ? 'disabled' : ''}>◀ ก่อนหน้า</button>
        <button class="btn btn-outline btn-xs" id="btn-next-page" ${state.page >= totalPages ? 'disabled' : ''}>ถัดไป ▶</button>
      </div>
    `;

    const signerName = village.signerName || '...................................................';
    const signerPos = village.signerPosition || 'นักวิชาการส่งเสริมการเกษตร';
    $('official-footer').innerHTML = `
      <div class="sign-block">
        <div>ลงชื่อ ............................................................</div>
        <div>(${escHtml(signerName)})</div>
        <div>ตำแหน่ง ${escHtml(signerPos)}</div>
      </div>
    `;

    // Bind events
    $('sel-rm-tambon').addEventListener('change', (e) => {
      state.tambonId = e.target.value;
      const t = getTambon(state.tambonId);
      state.villageId = t.villages[0].id;
      state.page = 1;
      state.search = '';
      render();
    });
    $('sel-rm-village').addEventListener('change', (e) => {
      state.villageId = e.target.value;
      state.page = 1;
      state.search = '';
      render();
    });
    $('inp-rm-search').addEventListener('input', (e) => {
      state.search = e.target.value;
      state.page = 1;
      render();
      const inp = $('inp-rm-search');
      if (inp) {
        inp.focus();
        inp.setSelectionRange(inp.value.length, inp.value.length);
      }
    });
    $('sel-rm-crop-filter').addEventListener('change', (e) => {
      state.cropFilter = e.target.value;
      state.page = 1;
      render();
    });
    $('chk-all-crops').addEventListener('change', (e) => {
      state.showAllCrops = e.target.checked;
      render();
    });
    $('btn-add-plot').addEventListener('click', () => openPlotModal(-1));
    $('btn-rm-import-xlsx').addEventListener('click', () => openImportExcelModal());
    $('btn-export-current').addEventListener('click', () => exportRMExcel(tambon, village));
    $('btn-print').addEventListener('click', () => {
      const prevSize = state.pageSize;
      if (prevSize !== 0) {
        state.pageSize = 0;
        render();
        setTimeout(() => {
          window.print();
          state.pageSize = prevSize;
          render();
        }, 120);
      } else {
        window.print();
      }
    });

    $('sel-page-size').addEventListener('change', (e) => {
      state.pageSize = Number(e.target.value);
      state.page = 1;
      render();
    });
    $('btn-prev-page').addEventListener('click', () => {
      if (state.page > 1) {
        state.page--;
        render();
      }
    });
    $('btn-next-page').addEventListener('click', () => {
      if (state.page < totalPages) {
        state.page++;
        render();
      }
    });

    // Row Actions
    document.querySelectorAll('[data-edit-plot]').forEach((btn) => {
      btn.addEventListener('click', () => openPlotModal(Number(btn.dataset.editPlot)));
    });
    document.querySelectorAll('[data-add-subplot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.addSubplot);
        const existing = village.plots[idx];
        // Find max plot no for this farmer
        const sameFarmerPlots = village.plots.filter((x) => x.f === existing.f);
        const nextPlotNo = sameFarmerPlots.reduce((mx, x) => Math.max(mx, Number(x.p || 1)), 0) + 1;
        openPlotModal(-1, { prefillFarmer: existing.f, prefillPlotNo: nextPlotNo, insertAfterIdx: idx });
      });
    });
    document.querySelectorAll('[data-del-plot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.delPlot);
        const target = village.plots[idx];
        if (confirm(`ยืนยันการลบข้อมูลแปลงที่ ${target.p} ของ "${target.f}" (${target.a} ไร่)?\nยอดรวมใน รม., รต. และ รอ. จะอัปเดตอัตโนมัติ`)) {
          village.plots.splice(idx, 1);
          saveData();
          render();
          showToast('🗑️ ลบข้อมูลแปลงเรียบร้อยแล้ว (อัปเดตยอด รต./รอ. แล้ว)');
        }
      });
    });
  }

  // ========================
  // PLOT ADD / EDIT MODAL
  // ========================
  let modalInsertAfterIdx = -1;

  function populateModalLocationSelectors(selTambonId, selVillageId) {
    const tSel = $('pf-tambon');
    tSel.innerHTML = appData.tambons.map((t) => `<option value="${t.id}" ${t.id === selTambonId ? 'selected' : ''}>ตำบล${escHtml(t.name)}</option>`).join('');
    const t = getTambon(selTambonId);
    const vSel = $('pf-village');
    vSel.innerHTML = t.villages.map((v) => `<option value="${v.id}" ${v.id === selVillageId ? 'selected' : ''}>หมู่ ${v.moo} บ้าน${escHtml(v.name)}</option>`).join('');

    // Populate farmer autocomplete datalist
    const v = getVillage(selTambonId, selVillageId);
    const uniqueNames = [...new Set(v.plots.map((p) => p.f).filter(Boolean))];
    $('farmer-datalist').innerHTML = uniqueNames.map((n) => `<option value="${escHtml(n)}"></option>`).join('');
  }

  function createCropBlockHTML(cropId, vals = {}) {
    const crop = appData.crops.find((c) => c.id === cropId);
    if (!crop) return '';
    const n = vals.n || 0;
    const s = vals.s || 0;
    const h = vals.h || 0;
    const ns = vals.ns || 0;
    const ks = vals.ks || 0;
    const y = vals.y !== undefined ? vals.y : crop.defaultYield || 0;
    const p = vals.p || 0;

    return `
      <div class="crop-block" data-crop-id="${crop.id}">
        <div class="crop-block-head">
          <span class="crop-block-title">${crop.num}. ${escHtml(crop.name)} ${crop.variety ? `(${escHtml(crop.variety)})` : ''}</span>
          <button type="button" class="btn btn-xs btn-del btn-remove-crop">ลบพืชนี้</button>
        </div>
        <div class="crop-fields-grid">
          <div>
            <label>ปลูกใหม่ (ไร่)</label>
            <input type="number" step="0.01" min="0" class="cf-n" value="${n}" />
          </div>
          <div>
            <label>ยืนต้น (ไร่)</label>
            <input type="number" step="0.01" min="0" class="cf-s" value="${s}" />
          </div>
          <div>
            <label>เก็บเกี่ยว (ไร่)</label>
            <input type="number" step="0.01" min="0" class="cf-h" value="${h}" />
          </div>
          ${
            crop.hasCassavaSplit
              ? `
          <div>
            <label>ไม่เก็บท่อนพันธุ์ (ไร่)</label>
            <input type="number" step="0.01" min="0" class="cf-ns" value="${ns}" />
          </div>
          <div>
            <label>เก็บท่อนพันธุ์ (ไร่)</label>
            <input type="number" step="0.01" min="0" class="cf-ks" value="${ks}" />
          </div>`
              : ''
          }
          <div>
            <label>เฉลี่ย (กก./ไร่)</label>
            <input type="number" step="1" min="0" class="cf-y" value="${y}" />
          </div>
          <div>
            <label>ผลผลิตรวม (กก.)</label>
            <input type="number" step="1" min="0" class="cf-p" value="${p}" />
          </div>
        </div>
      </div>
    `;
  }

  function bindCropBlockEvents(block) {
    const recalc = () => {
      const n = Number(block.querySelector('.cf-n').value || 0);
      const s = Number(block.querySelector('.cf-s').value || 0);
      const h = Number(block.querySelector('.cf-h').value || 0);
      const y = Number(block.querySelector('.cf-y').value || 0);
      const baseArea = h > 0 ? h : s > 0 ? s : n;
      block.querySelector('.cf-p').value = Math.round(baseArea * y);
    };
    ['.cf-n', '.cf-s', '.cf-h', '.cf-y'].forEach((sel) => {
      block.querySelector(sel).addEventListener('input', recalc);
    });
    block.querySelector('.btn-remove-crop').addEventListener('click', () => {
      block.remove();
    });
  }

  function openPlotModal(editIdx = -1, opts = {}) {
    modalInsertAfterIdx = opts.insertAfterIdx !== undefined ? opts.insertAfterIdx : -1;
    const isEdit = editIdx >= 0;
    $('edit-plot-index').value = editIdx;
    $('plot-modal-title').textContent = isEdit ? 'แก้ไขข้อมูลเกษตรกร / แปลงปลูก' : 'เพิ่มข้อมูลเกษตรกร / แปลงปลูกใหม่';

    populateModalLocationSelectors(state.tambonId, state.villageId);
    $('pf-tambon').disabled = isEdit;
    $('pf-village').disabled = isEdit;

    $('pf-add-crop-select').innerHTML = appData.crops
      .map((c) => `<option value="${c.id}">${c.num}. ${escHtml(c.name)}</option>`)
      .join('');

    const cropsContainer = $('pf-crops-container');
    cropsContainer.innerHTML = '';

    if (isEdit) {
      const v = getVillage(state.tambonId, state.villageId);
      const plot = v.plots[editIdx];
      $('pf-farmer').value = plot.f || '';
      $('pf-plotno').value = plot.p || 1;
      $('pf-docno').value = plot.d || '';
      $('pf-area').value = plot.a || 0;

      const cKeys = plot.c ? Object.keys(plot.c) : [];
      if (cKeys.length > 0) {
        cKeys.forEach((cid) => {
          cropsContainer.insertAdjacentHTML('beforeend', createCropBlockHTML(cid, plot.c[cid]));
        });
      } else {
        cropsContainer.insertAdjacentHTML('beforeend', createCropBlockHTML('rice', { s: plot.a || 0, y: 400, p: Math.round((plot.a || 0) * 400) }));
      }
    } else {
      $('pf-farmer').value = opts.prefillFarmer || '';
      $('pf-plotno').value = opts.prefillPlotNo || 1;
      $('pf-docno').value = '';
      $('pf-area').value = 0;
      cropsContainer.insertAdjacentHTML('beforeend', createCropBlockHTML('rice', { s: 0, y: 400, p: 0 }));
    }

    cropsContainer.querySelectorAll('.crop-block').forEach(bindCropBlockEvents);
    $('plot-modal').hidden = false;
    $('pf-farmer').focus();
  }

  // ========================
  // EXCEL EXPORT (OFFICIAL FORMAT รอ. / รต. / รม.)
  // ========================
  function buildOfficialCropHeaderRows(prefixColsCount, isROorRT) {
    const row1 = new Array(prefixColsCount).fill('');
    const row2 = new Array(prefixColsCount).fill('');
    const merges = [];

    if (isROorRT === 'ro') {
      row1[0] = 'ที่';
      row1[1] = 'ตำบล';
      row1[2] = 'ครัวเรือนเกษตรกร (ราย)';
      row1[3] = 'พื้นที่การเกษตร(ไร่)';
    } else if (isROorRT === 'rt') {
      row1[0] = 'หมู่ที่';
      row1[1] = 'ชื่อหมู่บ้าน';
      row1[2] = 'ครัวเรือนเกษตรกร (ราย)';
      row1[3] = 'พื้นที่การเกษตร(ไร่)';
    } else {
      row1[0] = 'ลำดับที่';
      row1[1] = 'ชื่อ-สกุลเกษตรกร';
      row1[2] = 'แปลงที่';
      row1[3] = 'เลขเอกสารสิทธิ์ (ถ้ามี)';
      row1[4] = 'พื้นที่การเกษตร(ไร่)';
    }

    // Merge prefix header rows vertically (rows 3..4 in 0-based index)
    for (let c = 0; c < prefixColsCount; c++) {
      merges.push({ s: { r: 3, c }, e: { r: 4, c } });
    }

    let col = prefixColsCount;
    appData.crops.forEach((crop) => {
      const span = crop.hasCassavaSplit ? 7 : 5;
      const label = `${crop.num}. ชนิดพืช ${crop.name} /พันธุ์ ${crop.variety || '................................'}`;
      row1.push(label);
      for (let i = 1; i < span; i++) row1.push('');
      merges.push({ s: { r: 3, c: col }, e: { r: 3, c: col + span - 1 } });

      if (crop.hasCassavaSplit) {
        row2.push(
          'พื้นที่ปลูกใหม่(ไร่)',
          'พื้นที่ยืนต้น(ไร่)',
          'พื้นที่เก็บเกี่ยว(ไร่)',
          'ไม่เก็บท่อนพันธุ์ไว้ใช้ต่อ (ไร่)',
          'เก็บท่อนพันธุ์ไว้ใช้ต่อ (ไร่)',
          'ผลผลิตรวม (กก.)',
          'ผลผลิตเฉลี่ย (กก./ไร่)'
        );
      } else {
        row2.push(
          'พื้นที่ปลูกใหม่(ไร่)',
          'พื้นที่ยืนต้น(ไร่)',
          'พื้นที่เก็บเกี่ยว(ไร่)',
          'ผลผลิตรวม (กก.)',
          'ผลผลิตเฉลี่ย (กก./ไร่)'
        );
      }
      col += span;
    });

    return { row1, row2, merges, totalCols: col };
  }

  function cropObjToRowCells(cropsObj) {
    const arr = [];
    appData.crops.forEach((crop) => {
      const cv = (cropsObj && cropsObj[crop.id]) || null;
      if (crop.hasCassavaSplit) {
        arr.push(
          cv && cv.n ? cv.n : '',
          cv && cv.s ? cv.s : '',
          cv && cv.h ? cv.h : '',
          cv && cv.ns ? cv.ns : '',
          cv && cv.ks ? cv.ks : '',
          cv && cv.p ? cv.p : '',
          cv && cv.y ? cv.y : ''
        );
      } else {
        arr.push(
          cv && cv.n ? cv.n : '',
          cv && cv.s ? cv.s : '',
          cv && cv.h ? cv.h : '',
          cv && cv.p ? cv.p : '',
          cv && cv.y ? cv.y : ''
        );
      }
    });
    return arr;
  }

  function createROSheet() {
    const dist = summarizeDistrict();
    const m = appData.meta;
    const hdr = buildOfficialCropHeaderRows(4, 'ro');
    const aoa = [
      [`แบบจัดเก็บข้อมูลการผลิตทางการเกษตรด้านพืชรายอำเภอ ${m.district} จังหวัด${m.province} (รอ.)`],
      [`ข้อมูล ณ วันที่ ${m.reportDay} เดือน ${m.reportMonth} พ.ศ. ${m.reportYear}`],
      [],
      hdr.row1,
      hdr.row2,
    ];
    dist.tambonSummaries.forEach((item, idx) => {
      aoa.push([
        idx + 1,
        item.tambon.name,
        item.summary.farmersCount,
        item.summary.totalArea,
        ...cropObjToRowCells(item.summary.crops),
      ]);
    });
    aoa.push([]);
    aoa.push(['รวม', '', dist.farmersCount, dist.totalArea, ...cropObjToRowCells(dist.crops)]);
    aoa.push([]);
    aoa.push(['ลงชื่อ..................................']);
    aoa.push([`(${m.districtOfficer})`]);
    aoa.push([`ตำแหน่ง ${m.districtPosition}`]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = hdr.merges;
    return ws;
  }

  function createRTSheet(tambon) {
    const ts = summarizeTambon(tambon);
    const m = appData.meta;
    const hdr = buildOfficialCropHeaderRows(4, 'rt');
    const aoa = [
      [`แบบจัดเก็บข้อมูลการผลิตทางการเกษตรด้านพืชรายตำบล ${tambon.name} อำเภอ ${m.district} จังหวัด${m.province} (รต.)`],
      [`ข้อมูล ณ วันที่ ${m.reportDay} เดือน ${m.reportMonth} พ.ศ. ${m.reportYear}`],
      [],
      hdr.row1,
      hdr.row2,
    ];
    ts.villageSummaries.forEach((item) => {
      aoa.push([
        item.village.moo,
        item.village.name,
        item.summary.farmersCount,
        item.summary.totalArea,
        ...cropObjToRowCells(item.summary.crops),
      ]);
    });
    aoa.push([]);
    aoa.push(['รวม', '', ts.farmersCount, ts.totalArea, ...cropObjToRowCells(ts.crops)]);
    aoa.push([]);
    aoa.push(['ลงชื่อ..................................']);
    aoa.push([`(${m.districtOfficer})`]);
    aoa.push([`ตำแหน่ง ${m.districtPosition}`]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = hdr.merges;
    return ws;
  }

  function createRMSheet(tambon, village) {
    const vs = summarizeVillage(village);
    const m = appData.meta;
    const hdr = buildOfficialCropHeaderRows(5, 'rm');
    const aoa = [
      [`แบบจัดเก็บข้อมูลการผลิตทางการเกษตรด้านพืชรายหมู่บ้าน หมู่ที่ ${village.moo} บ้าน${village.name} ตำบล${tambon.name} อำเภอ${m.district} จังหวัด${m.province} (รม.)`],
      [`ข้อมูล ณ วันที่ ${m.reportDay} เดือน ${m.reportMonth} พ.ศ. ${m.reportYear}`],
      [],
      hdr.row1,
      hdr.row2,
    ];
    let seq = 0;
    let prev = null;
    village.plots.forEach((p) => {
      const isNew = p.f !== prev;
      if (isNew) {
        seq++;
        prev = p.f;
      }
      aoa.push([
        isNew ? seq : '',
        isNew ? p.f : '',
        p.p || 1,
        p.d || '',
        p.a || 0,
        ...cropObjToRowCells(p.c),
      ]);
    });
    aoa.push([]);
    aoa.push(['รวม', '', '', '', vs.totalArea, ...cropObjToRowCells(vs.crops)]);
    aoa.push([]);
    aoa.push([`ลงชื่อ ${village.signerName || '..................................'}`]);
    aoa.push([`(${village.signerName || '..................................'})`]);
    aoa.push([`ตำแหน่ง ${village.signerPosition || 'นักวิชาการส่งเสริมการเกษตร'}`]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = hdr.merges;
    return ws;
  }

  function safeSheetName(name, used) {
    let clean = name.replace(/[\\/?*[\]:]/g, '').trim().slice(0, 31);
    let candidate = clean;
    let i = 2;
    while (used.has(candidate)) {
      candidate = clean.slice(0, 28) + '_' + i++;
    }
    used.add(candidate);
    return candidate;
  }

  function exportROExcel() {
    if (typeof XLSX === 'undefined') return alert('ไม่พบไลบรารี SheetJS กรุณาเชื่อมต่ออินเทอร์เน็ต');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, createROSheet(), 'อำเภอสีดา (รอ.)');
    XLSX.writeFile(wb, `แบบ_รอ_อำเภอสีดา.xlsx`);
    showToast('📊 ดาวน์โหลดแบบ รอ. สำเร็จ');
  }

  function exportRTExcel(tambon) {
    if (typeof XLSX === 'undefined') return alert('ไม่พบไลบรารี SheetJS กรุณาเชื่อมต่ออินเทอร์เน็ต');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, createRTSheet(tambon), `ต.${tambon.name}`.slice(0, 31));
    XLSX.writeFile(wb, `แบบ_รต_ตำบล${tambon.name}.xlsx`);
    showToast(`📊 ดาวน์โหลดแบบ รต. ตำบล${tambon.name} สำเร็จ`);
  }

  function exportRMExcel(tambon, village) {
    if (typeof XLSX === 'undefined') return alert('ไม่พบไลบรารี SheetJS กรุณาเชื่อมต่ออินเทอร์เน็ต');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, createRMSheet(tambon, village), `หมู่${village.moo}_${village.name}`.slice(0, 31));
    XLSX.writeFile(wb, `แบบ_รม_หมู่${village.moo}_${village.name}_ต.${tambon.name}.xlsx`);
    showToast(`📊 ดาวน์โหลดแบบ รม. บ้าน${village.name} สำเร็จ`);
  }

  function exportAllWorkbookExcel() {
    if (typeof XLSX === 'undefined') return alert('ไม่พบไลบรารี SheetJS กรุณาเชื่อมต่ออินเทอร์เน็ต');
    showToast('⏳ กำลังสร้างไฟล์ Excel ทั้ง 56 ชีต...');
    setTimeout(() => {
      const wb = XLSX.utils.book_new();
      const used = new Set();
      XLSX.utils.book_append_sheet(wb, createROSheet(), safeSheetName('อำเภอสีดา', used));
      appData.tambons.forEach((t) => {
        XLSX.utils.book_append_sheet(wb, createRTSheet(t), safeSheetName(`ตำบล${t.name}`, used));
        t.villages.forEach((v) => {
          XLSX.utils.book_append_sheet(wb, createRMSheet(t, v), safeSheetName(`ม.${v.moo} ${v.name}`, used));
        });
      });
      XLSX.writeFile(wb, `แบบจัดเก็บข้อมูลด้านพืช_อำเภอสีดา_ครบทุกชีต.xlsx`);
      showToast('✅ ดาวน์โหลดไฟล์ Excel ครบ 56 ชีตเรียบร้อย!');
    }, 80);
  }

  // ========================
  // IMPORT EXCEL (.xlsx) TO UPDATE DATA
  // ========================
  let pendingExcelImport = null;

  function toNumCell(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? round4(v) : 0;
    const s = String(v).trim().replace(/,/g, '');
    if (!s || s === '-') return 0;
    const n = Number(s);
    return Number.isFinite(n) ? round4(n) : 0;
  }

  function cleanCellStr(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function normalizeThaiName(s) {
    return String(s || '')
      .replace(/หมู่(?:ที่)?\s*\d+/g, '')
      .replace(/ตำบล|บ้าน|ต\.|ม\.|[\.\s_]/g, '')
      .replace(/ทองหลางใญ่/g, 'ทองหลางใหญ่')
      .replace(/หนองเทีนมพัฒนา/g, 'หนองเทียมพัฒนา')
      .replace(/หนองหว้า/g, 'หนองว้า')
      .replace(/ตะกุดขอน/g, 'ตะกุกขอน')
      .trim();
  }

  function matchTargetVillage(sheetName, headerLine, currentTambonHint, fallbackValue) {
    const h = String(headerLine || '');
    const s = String(sheetName || '');

    // 1) Detect Tambon from header text first, or currentTambonHint
    let matchedTambon = null;
    for (const t of appData.tambons) {
      if (h.includes('ตำบล' + t.name) || h.includes('ตำบล.' + t.name) || h.includes('ตำบล..' + t.name) || h.includes('ตำบล ' + t.name)) {
        matchedTambon = t;
        break;
      }
    }
    if (!matchedTambon) {
      for (const t of appData.tambons) {
        const idxT = h.indexOf('ตำบล');
        if (idxT >= 0 && h.slice(idxT, idxT + 30).includes(t.name)) {
          matchedTambon = t;
          break;
        }
      }
    }
    if (!matchedTambon && currentTambonHint) {
      matchedTambon = currentTambonHint;
    }

    // 2) Detect Moo number from sheet name or header
    const mooMatchSheet = s.match(/(?:หมู่(?:ที่)?|ม\.)\s*(\d+)/);
    const mooMatchHeader = h.match(/หมู่ที่\s*(\d+)/);
    const mooNum = mooMatchSheet ? Number(mooMatchSheet[1]) : mooMatchHeader ? Number(mooMatchHeader[1]) : null;

    // 3) Match within matchedTambon by Moo or Village name
    if (matchedTambon) {
      if (mooNum) {
        const byMoo = matchedTambon.villages.find((v) => v.moo === mooNum);
        if (byMoo) return { tambon: matchedTambon, village: byMoo };
      }
      const normS = normalizeThaiName(s);
      const byName = matchedTambon.villages.find((v) => {
        const nv = normalizeThaiName(v.name);
        return nv && (normS.includes(nv) || nv.includes(normS) || normalizeThaiName(h).includes(nv));
      });
      if (byName) return { tambon: matchedTambon, village: byName };
    }

    // 4) Search across all tambons by exact village name + optional moo
    const normS = normalizeThaiName(s);
    for (const t of appData.tambons) {
      for (const v of t.villages) {
        const nv = normalizeThaiName(v.name);
        if (nv && normS && (normS === nv || (mooNum === v.moo && (normS.includes(nv) || nv.includes(normS))))) {
          return { tambon: t, village: v };
        }
      }
    }

    // 5) Fallback to user-selected village when single-sheet import
    if (fallbackValue) {
      const [ftId, fvId] = fallbackValue.split('|');
      const ft = getTambon(ftId);
      const fv = getVillage(ftId, fvId);
      if (ft && fv) return { tambon: ft, village: fv, isFallback: true };
    }
    return null;
  }

  function parseRMSheetRows(rows) {
    // Find header row containing "ชื่อ-สกุลเกษตรกร"
    let headerIdx = -1;
    for (let i = 0; i < Math.min(12, rows.length); i++) {
      const r = rows[i] || [];
      if (r.some((c) => cleanCellStr(c).includes('ชื่อ-สกุลเกษตรกร'))) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) return null;

    const headerRow = rows[headerIdx] || [];
    const cropCols = [];
    for (let c = 0; c < headerRow.length; c++) {
      const txt = cleanCellStr(headerRow[c]);
      if (!txt) continue;
      let cid = null;
      if (txt.includes('ข้าวโพด')) cid = 'corn';
      else if (txt.includes('ข้าว') && txt.includes('1.')) cid = 'rice';
      else if (txt.includes('มันสำปะหลัง')) cid = 'cassava';
      else if (txt.includes('อ้อย')) cid = 'sugarcane';
      else if (txt.includes('ทุเรียน')) cid = 'durian';
      else if (txt.includes('กล้วยหอม')) cid = 'banana_hom';
      else if (txt.includes('มะม่วง')) cid = 'mango';
      else if (txt.includes('ละมุด')) cid = 'sapodilla';
      else if (txt.includes('น้อยหน่า')) cid = 'sugar_apple';
      else if (txt.includes('อื่นๆ') || txt.includes('กล้วยน้ำว้า')) cid = 'other_banana';
      if (cid) cropCols.push({ cid, startC: c });
    }

    const plots = [];
    let lastFarmer = '';
    for (let rIdx = headerIdx + 2; rIdx < rows.length; rIdx++) {
      const r = rows[rIdx] || [];
      const c0 = cleanCellStr(r[0]);
      const c1 = cleanCellStr(r[1]);
      const c2 = cleanCellStr(r[2]);
      const c3 = cleanCellStr(r[3]);
      const c4 = toNumCell(r[4]);

      if (c0.startsWith('รวม') || c1.startsWith('รวม') || c0.includes('ลงชื่อ') || c1.includes('ลงชื่อ')) {
        break;
      }
      if (!c0 && !c1 && !c2 && c4 === 0) continue;

      if (c1) lastFarmer = c1;
      const plotNo = c2 ? Math.max(1, Math.round(toNumCell(c2))) : 1;

      const cropsData = {};
      cropCols.forEach(({ cid, startC }) => {
        if (cid === 'cassava') {
          const n = toNumCell(r[startC]);
          const s = toNumCell(r[startC + 1]);
          const h = toNumCell(r[startC + 2]);
          const ns = toNumCell(r[startC + 3]);
          const ks = toNumCell(r[startC + 4]);
          const p = toNumCell(r[startC + 5]);
          const y = toNumCell(r[startC + 6]);
          if (n || s || h || ns || ks || p || y) {
            cropsData[cid] = { n, s, h, ns, ks, p, y };
          }
        } else {
          const n = toNumCell(r[startC]);
          const s = toNumCell(r[startC + 1]);
          const h = toNumCell(r[startC + 2]);
          let p = toNumCell(r[startC + 3]);
          const y = toNumCell(r[startC + 4]);
          if (cid === 'sugarcane' && s === 23 && y === 10000 && p === 23000) p = 230000;
          if (n || s || h || p || y) {
            cropsData[cid] = { n, s, h, p, y };
          }
        }
      });

      plots.push({
        f: lastFarmer,
        p: plotNo,
        d: c3,
        a: c4,
        c: cropsData,
      });
    }

    // Try reading signer from bottom rows
    let signerName = '';
    let signerPos = '';
    for (let i = Math.max(headerIdx + 2, rows.length - 12); i < rows.length; i++) {
      const joined = (rows[i] || []).map(cleanCellStr).filter(Boolean).join(' ');
      if (joined.includes('(') && joined.includes(')') && !joined.includes('ไร่') && !joined.includes('กก')) {
        const ms = joined.match(/\(([^)]+)\)/);
        if (ms && ms[1].trim().length > 3 && !ms[1].includes('....')) signerName = ms[1].trim();
      }
      if (joined.includes('ตำแหน่ง')) {
        const pos = joined.replace('ตำแหน่ง', '').trim();
        if (pos && !pos.includes('....')) signerPos = pos;
      }
    }

    return { plots, signerName, signerPos };
  }

  function openImportExcelModal() {
    pendingExcelImport = null;
    $('imp-preview-area').hidden = true;
    $('imp-preview-area').innerHTML = '';
    $('btn-confirm-import-excel').disabled = true;
    $('input-import-excel').value = '';

    // Populate fallback village dropdown
    const opts = [];
    appData.tambons.forEach((t) => {
      t.villages.forEach((v) => {
        const val = `${t.id}|${v.id}`;
        const sel = t.id === state.tambonId && v.id === state.villageId ? 'selected' : '';
        opts.push(`<option value="${val}" ${sel}>ต.${escHtml(t.name)} — หมู่ ${v.moo} บ้าน${escHtml(v.name)}</option>`);
      });
    });
    $('imp-fallback-village').innerHTML = opts.join('');
    $('import-excel-modal').hidden = false;
  }

  function handleExcelFileSelected(file) {
    if (!file) return;
    if (typeof XLSX === 'undefined') {
      alert('ไม่พบไลบรารี SheetJS กรุณาเชื่อมต่ออินเทอร์เน็ต');
      return;
    }

    const preview = $('imp-preview-area');
    preview.hidden = false;
    preview.innerHTML = `<div style="text-align:center;padding:16px;color:#475569;">⏳ กำลังอ่านไฟล์ <strong>${escHtml(file.name)}</strong> ...</div>`;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
        const fallbackVal = wb.SheetNames.length === 1 ? $('imp-fallback-village').value : null;

        let currentTambonHint = null;
        const matchedSheets = [];
        const skippedSheets = [];

        wb.SheetNames.forEach((sName) => {
          const ws = wb.Sheets[sName];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          if (!rows || rows.length < 5) {
            skippedSheets.push({ name: sName, reason: 'ไม่มีข้อมูล' });
            return;
          }
          const r1 = cleanCellStr(rows[0] && rows[0][0]);

          // Check if it is a Tambon (รต.) sheet -> update currentTambonHint and skip
          if (sName.startsWith('ตำบล') || r1.includes('(รต.)') || r1.includes('รายตำบล')) {
            const foundT = appData.tambons.find((t) => sName.includes(t.name) || r1.includes(t.name));
            if (foundT) currentTambonHint = foundT;
            skippedSheets.push({ name: sName, reason: 'แบบ รต. (ระบบคำนวณอัตโนมัติจาก รม.)' });
            return;
          }
          if (sName.includes('อำเภอสีดา') || r1.includes('(รอ.)') || r1.includes('รายอำเภอ')) {
            skippedSheets.push({ name: sName, reason: 'แบบ รอ. (ระบบคำนวณอัตโนมัติจาก รม.)' });
            return;
          }

          const parsed = parseRMSheetRows(rows);
          if (!parsed) {
            skippedSheets.push({ name: sName, reason: 'ไม่พบหัวตารางแบบ รม.' });
            return;
          }

          const target = matchTargetVillage(sName, r1, currentTambonHint, fallbackVal);
          if (!target) {
            skippedSheets.push({ name: sName, reason: 'จับคู่ชื่อหมู่บ้านไม่พบ' });
            return;
          }

          const totalArea = round4(parsed.plots.reduce((acc, p) => acc + Number(p.a || 0), 0));
          matchedSheets.push({
            sheetName: sName,
            tambonId: target.tambon.id,
            tambonName: target.tambon.name,
            villageId: target.village.id,
            villageMoo: target.village.moo,
            villageName: target.village.name,
            plots: parsed.plots,
            totalArea,
            signerName: parsed.signerName,
            signerPos: parsed.signerPos,
          });
        });

        if (matchedSheets.length === 0) {
          pendingExcelImport = null;
          $('btn-confirm-import-excel').disabled = true;
          preview.innerHTML = `
            <div style="color:#dc2626;font-weight:700;margin-bottom:6px;">❌ ไม่พบชีตแบบ รม. ที่สามารถนำเข้าได้ในไฟล์นี้</div>
            <div style="font-size:13px;color:#475569;">ตรวจสอบว่าไฟล์มีคอลัมน์ "ชื่อ-สกุลเกษตรกร" ตามแบบฟอร์ม รม. หรือดาวน์โหลดไฟล์ต้นแบบจากปุ่ม "โหลด Excel" ไปแก้ไขแล้วอัปโหลดกลับมา</div>
          `;
          return;
        }

        pendingExcelImport = { fileName: file.name, matchedSheets };
        $('btn-confirm-import-excel').disabled = false;

        const sumPlots = matchedSheets.reduce((a, x) => a + x.plots.length, 0);
        const sumArea = matchedSheets.reduce((a, x) => a + x.totalArea, 0);
        const rowsHtml = matchedSheets
          .map(
            (m) => `
            <tr>
              <td>${escHtml(m.sheetName)}</td>
              <td><strong>ต.${escHtml(m.tambonName)}</strong> ม.${m.villageMoo} บ้าน${escHtml(m.villageName)}</td>
              <td style="text-align:right;">${fmtNumZero(m.plots.length, 0)} แปลง</td>
              <td style="text-align:right;">${fmtNumZero(m.totalArea, 2)} ไร่</td>
            </tr>`
          )
          .join('');

        preview.innerHTML = `
          <div class="imp-summary-banner">
            <div class="imp-badge ok">✅ พบข้อมูลแบบ รม. ${matchedSheets.length} หมู่บ้าน</div>
            <div class="imp-badge">รวม ${fmtNumZero(sumPlots, 0)} แปลง</div>
            <div class="imp-badge">พื้นที่รวม ${fmtNumZero(sumArea, 2)} ไร่</div>
          </div>
          <div class="imp-list">
            <table>
              <thead>
                <tr>
                  <th>ชื่อชีตใน Excel</th>
                  <th>หมู่บ้านปลายทางที่จะอัปเดต</th>
                  <th style="text-align:right;">จำนวนแปลง</th>
                  <th style="text-align:right;">พื้นที่ (ไร่)</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
          ${
            skippedSheets.length > 0
              ? `<div style="margin-top:8px;font-size:12px;color:#64748b;">ข้ามชีตที่ไม่ใช่ รม. จำนวน ${skippedSheets.length} ชีต (เช่น รอ./รต. ซึ่งระบบจะคำนวณรวมใหม่ให้อัตโนมัติ)</div>`
              : ''
          }
        `;
      } catch (err) {
        console.error(err);
        pendingExcelImport = null;
        $('btn-confirm-import-excel').disabled = true;
        preview.innerHTML = `<div style="color:#dc2626;font-weight:700;">❌ อ่านไฟล์ Excel ไม่สำเร็จ: ${escHtml(err.message)}</div>`;
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // ========================
  // NAVIGATION & RENDER
  // ========================
  function switchView(viewName) {
    state.view = viewName;
    document.querySelectorAll('.nav-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.view === viewName);
    });
    render();
  }

  function render() {
    updateHeaderDate();
    const isDash = state.view === 'dashboard';
    $('dashboard-view').hidden = !isDash;
    $('form-paper').hidden = isDash;
    if (isDash) renderDashboard();
    else if (state.view === 'ro') renderViewRO();
    else if (state.view === 'rt') renderViewRT();
    else renderViewRM();
  }

  // ========================
  // INITIALIZE & GLOBAL EVENTS
  // ========================
  function showApp() {
    $('login-screen').hidden = true;
    $('app-shell').hidden = false;
    render();
  }

  function init() {
    loadData();

    // Auth check
    if (sessionStorage.getItem(AUTH_SESSION_KEY) === '1') {
      showApp();
    }

    $('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const val = $('pin-input').value.trim();
      if (val === ACCESS_PIN) {
        sessionStorage.setItem(AUTH_SESSION_KEY, '1');
        $('login-error').hidden = true;
        showApp();
      } else {
        $('login-error').hidden = false;
        $('pin-input').value = '';
        $('pin-input').focus();
      }
    });

    $('btn-logout').addEventListener('click', () => {
      sessionStorage.removeItem(AUTH_SESSION_KEY);
      $('app-shell').hidden = true;
      $('login-screen').hidden = false;
      $('pin-input').value = '';
      $('pin-input').focus();
    });

    // Nav tabs
    document.querySelectorAll('.nav-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchView(tab.dataset.view));
    });

    // Close modals
    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => {
        $(btn.dataset.close).hidden = true;
      });
    });

    // Plot modal: tambon change updates village list
    $('pf-tambon').addEventListener('change', (e) => {
      const t = getTambon(e.target.value);
      populateModalLocationSelectors(t.id, t.villages[0].id);
    });

    // Plot modal: sync area -> first crop's standing area if 0
    $('pf-area').addEventListener('input', (e) => {
      const val = Number(e.target.value || 0);
      const firstBlock = $('pf-crops-container').querySelector('.crop-block');
      if (firstBlock && Number($('edit-plot-index').value) < 0) {
        const sInp = firstBlock.querySelector('.cf-s');
        const hInp = firstBlock.querySelector('.cf-h');
        const nInp = firstBlock.querySelector('.cf-n');
        if (Number(hInp.value || 0) === 0 && Number(nInp.value || 0) === 0) {
          sInp.value = Math.floor(val);
          sInp.dispatchEvent(new Event('input'));
        }
      }
    });

    // Add crop block button
    $('btn-add-crop-block').addEventListener('click', () => {
      const cid = $('pf-add-crop-select').value;
      const container = $('pf-crops-container');
      if (container.querySelector(`[data-crop-id="${cid}"]`)) {
        showToast('มีชนิดพืชนี้อยู่ในแปลงแล้ว');
        return;
      }
      container.insertAdjacentHTML('beforeend', createCropBlockHTML(cid));
      bindCropBlockEvents(container.lastElementChild);
    });

    // Submit Plot Form
    $('plot-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const editIdx = Number($('edit-plot-index').value);
      const tId = $('pf-tambon').value;
      const vId = $('pf-village').value;
      const village = getVillage(tId, vId);

      const cropsObj = {};
      $('pf-crops-container')
        .querySelectorAll('.crop-block')
        .forEach((blk) => {
          const cid = blk.dataset.cropId;
          const cropDef = appData.crops.find((c) => c.id === cid);
          const n = round4(blk.querySelector('.cf-n').value);
          const s = round4(blk.querySelector('.cf-s').value);
          const h = round4(blk.querySelector('.cf-h').value);
          const p = round4(blk.querySelector('.cf-p').value);
          const y = round4(blk.querySelector('.cf-y').value);
          if (cropDef && cropDef.hasCassavaSplit) {
            const ns = round4(blk.querySelector('.cf-ns').value);
            const ks = round4(blk.querySelector('.cf-ks').value);
            if (n || s || h || ns || ks || p || y) {
              cropsObj[cid] = { n, s, h, ns, ks, p, y };
            }
          } else {
            if (n || s || h || p || y) {
              cropsObj[cid] = { n, s, h, p, y };
            }
          }
        });

      const newPlot = {
        f: $('pf-farmer').value.trim(),
        p: Number($('pf-plotno').value || 1),
        d: $('pf-docno').value.trim(),
        a: round4($('pf-area').value),
        c: cropsObj,
      };

      if (editIdx >= 0) {
        village.plots[editIdx] = newPlot;
        showToast('✅ แก้ไขข้อมูลเรียบร้อย (อัปเดต รต. และ รอ. แล้ว)');
      } else if (modalInsertAfterIdx >= 0) {
        village.plots.splice(modalInsertAfterIdx + 1, 0, newPlot);
        showToast('✅ เพิ่มแปลงต่อจากเกษตรกรรายเดิมเรียบร้อย');
      } else {
        village.plots.push(newPlot);
        showToast('✅ เพิ่มข้อมูลเกษตรกรใหม่เรียบร้อย (อัปเดต รต. และ รอ. แล้ว)');
      }

      state.tambonId = tId;
      state.villageId = vId;
      saveData();
      $('plot-modal').hidden = true;
      render();
    });

    // Meta Settings Modal
    $('btn-edit-meta').addEventListener('click', () => {
      const m = appData.meta;
      $('meta-day').value = m.reportDay;
      $('meta-month').value = m.reportMonth;
      $('meta-year').value = m.reportYear;
      $('meta-district-officer').value = m.districtOfficer;
      $('meta-district-pos').value = m.districtPosition;

      const vFields = $('village-signer-fields');
      if (state.view === 'rm') {
        const v = getVillage(state.tambonId, state.villageId);
        vFields.hidden = false;
        $('meta-village-officer').value = v.signerName || '';
        $('meta-village-pos').value = v.signerPosition || '';
      } else {
        vFields.hidden = true;
      }
      $('meta-modal').hidden = false;
    });

    $('meta-form').addEventListener('submit', (e) => {
      e.preventDefault();
      appData.meta.reportDay = $('meta-day').value.trim();
      appData.meta.reportMonth = $('meta-month').value.trim();
      appData.meta.reportYear = $('meta-year').value.trim();
      appData.meta.districtOfficer = $('meta-district-officer').value.trim();
      appData.meta.districtPosition = $('meta-district-pos').value.trim();
      if (state.view === 'rm') {
        const v = getVillage(state.tambonId, state.villageId);
        v.signerName = $('meta-village-officer').value.trim();
        v.signerPosition = $('meta-village-pos').value.trim();
      }
      saveData();
      $('meta-modal').hidden = true;
      render();
      showToast('⚙️ บันทึกการตั้งค่าแบบฟอร์มเรียบร้อย');
    });

    // Export All 56 Sheets
    $('btn-export-all-xlsx').addEventListener('click', exportAllWorkbookExcel);

    // Import Excel Modal
    $('btn-open-import-xlsx').addEventListener('click', openImportExcelModal);
    const dropzone = $('excel-dropzone');
    const excelInput = $('input-import-excel');
    dropzone.addEventListener('click', () => excelInput.click());
    excelInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) handleExcelFileSelected(e.target.files[0]);
    });
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleExcelFileSelected(e.dataTransfer.files[0]);
      }
    });

    $('btn-confirm-import-excel').addEventListener('click', () => {
      if (!pendingExcelImport || !pendingExcelImport.matchedSheets.length) return;
      const mode = $('imp-mode').value; // 'replace' | 'append'
      let updatedVillages = 0;
      let totalPlotsImported = 0;

      pendingExcelImport.matchedSheets.forEach((item) => {
        const v = getVillage(item.tambonId, item.villageId);
        if (!v) return;
        if (mode === 'replace') {
          v.plots = item.plots;
        } else {
          v.plots = v.plots.concat(item.plots);
        }
        if (item.signerName) v.signerName = item.signerName;
        if (item.signerPos) v.signerPos = item.signerPos;
        updatedVillages++;
        totalPlotsImported += item.plots.length;
      });

      // If single village imported, jump to that village or stay on dashboard
      if (pendingExcelImport.matchedSheets.length === 1) {
        state.tambonId = pendingExcelImport.matchedSheets[0].tambonId;
        state.villageId = pendingExcelImport.matchedSheets[0].villageId;
      }

      saveData();
      $('import-excel-modal').hidden = true;
      render();
      showToast(`✅ อัปเดตจาก Excel สำเร็จ! (${updatedVillages} หมู่บ้าน / ${fmtNumZero(totalPlotsImported, 0)} แปลง)`);
    });

    // Backup / Restore Modal
    $('btn-backup').addEventListener('click', () => {
      $('backup-modal').hidden = false;
    });

    $('btn-download-json').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_sida_agri_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('💾 ดาวน์โหลดไฟล์สำรองข้อมูลเรียบร้อย');
    });

    $('input-import-json').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!parsed.tambons || !parsed.crops) throw new Error('โครงสร้างไฟล์ไม่ถูกต้อง');
          appData = parsed;
          saveData();
          $('backup-modal').hidden = true;
          render();
          showToast('✅ นำเข้าข้อมูลสำรองเรียบร้อยแล้ว');
        } catch (err) {
          alert('ไม่สามารถนำเข้าไฟล์ได้: ' + err.message);
        }
      };
      reader.readAsText(file, 'utf-8');
      e.target.value = '';
    });

    $('btn-reset-data').addEventListener('click', () => {
      if (confirm('ยืนยันรีเซ็ตข้อมูลทั้งหมดกลับไปเป็นข้อมูลตั้งต้นจากไฟล์ Excel?\n(การแก้ไขที่บันทึกไว้ในเครื่องนี้จะถูกล้าง)')) {
        localStorage.removeItem(STORAGE_KEY);
        appData = JSON.parse(JSON.stringify(window.INITIAL_AGRI_DATA));
        $('backup-modal').hidden = true;
        render();
        showToast('🔄 รีเซ็ตข้อมูลกลับเป็นค่าตั้งต้นเรียบร้อย');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
