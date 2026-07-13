import React, { useState } from 'react';
import { LayoutDashboard, Map as MapIcon } from 'lucide-react';

const hindiDigitMap = {
  '०':'0','१':'1','२':'2','३':'3','४':'4','५':'5','६':'6','७':'7','८':'8','९':'9',
  '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
  '0':'0','1':'1','2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9'
};
const hindiNumberWords = {
  'शून्य':0,'एक':1,'दो':2,'तीन':3,'चार':4,'पांच':5,'पाँच':5,'छह':6,'सात':7,'आठ':8,'नौ':9,'दस':10,
  'ग्यारह':11,'बारह':12,'तेरह':13,'चौदह':14,'पंद्रह':15,'सोलह':16,'सत्रह':17,'अठारह':18,'उन्नीस':19,'बीस':20,
  'इक्कीस':21,'बाईस':22,'तेईस':23,'चौबीस':24,'पच्चीस':25,'छब्बीस':26,'सत्ताईस':27,'अट्ठाईस':28,'उनतीस':29,'तीस':30,
  'इकतीस':31,'बत्तीस':32,'तैंतीस':33,'चौंतीस':34,'पैंतीस':35,'छत्तीस':36,'सैंतीस':37,'अड़तीस':38,'उनतालीस':39,'चालीस':40,
  'इकतालीस':41,'बयालीस':42,'तैंतालीस':43,'चवालीस':44,'पैंतालीस':45,'छियालीस':46,'सैंतालीस':47,'अड़तालीस':48,'उनचास':49,'पचास':50,
  'इक्यावन':51,'बावन':52,'तिरपन':53,'चौवन':54,'पचपन':55,'छप्पन':56,'सत्तावन':57,'अट्ठावन':58,'उनसठ':59,'साठ':60,
  'इकसठ':61,'बासठ':62,'तिरसठ':63,'चौंसठ':64,'पैंसठ':65,'छियासठ':66,'सड़सठ':67,'अड़सठ':68,'उनहत्तर':69,'सत्तर':70,
  'इकहत्तर':71,'बहत्तर':72,'तिहत्तर':73,'चौहत्तर':74,'पचहत्तर':75,'छिहत्तर':76,'सतहत्तर':77,'अठहत्तर':78,'उनासी':79,'अस्सी':80,
  'इक्यासी':81,'बयासी':82,'तिरासी':83,'चौरासी':84,'पचासी':85,'छियासी':86,'सत्तासी':87,'अट्ठासी':88,'नवासी':89,'नब्बे':90,
  'इक्यानवे':91,'बानवे':92,'तिरानवे':93,'चौरानवे':94,'पचानवे':95,'छियानवे':96,'सत्तानवे':97,'अट्ठानवे':98,'निन्यानवे':99,'सौ':100
};
const areaFactorsToSqft = {
  sqft: 1,
  sqmt: 10.7639104167,
  hectare: 107639.104167,
  acre: 43560,
  bigha_up: 27000,
  biswa_up: 1350,
  sqyd: 9
};
const areaLabels = { sqft: 'Square feet', sqmt: 'Square metre', hectare: 'Hectare', acre: 'Acre', bigha_up: 'Bigha (UP approx.)', biswa_up: 'Biswa (UP approx.)', sqyd: 'Square yard' };
const parseHindiNumber = (input = '') => {
  const text = String(input).trim();
  if (!text) return '';
  const digitConverted = text.split('').map(ch => hindiDigitMap[ch] ?? ch).join('');
  if (/^[0-9.,\s]+$/.test(digitConverted)) return digitConverted.replace(/,/g,'').trim();
  const normalized = text.replace(/[।,]/g, ' ').replace(/\s+/g, ' ').trim();
  let total = 0, current = 0, found = false;
  normalized.split(' ').forEach(word => {
    if (hindiNumberWords[word] !== undefined) { current += hindiNumberWords[word]; found = true; return; }
    if (word === 'हजार') { total += (current || 1) * 1000; current = 0; found = true; return; }
    if (word === 'लाख') { total += (current || 1) * 100000; current = 0; found = true; return; }
    if (word === 'करोड़' || word === 'करोड') { total += (current || 1) * 10000000; current = 0; found = true; return; }
  });
  return found ? String(total + current) : digitConverted;
};
export const CalculatorView = () => {
  const [value, setValue] = useState('1');
  const [fromUnit, setFromUnit] = useState('hectare');
  const [toUnit, setToUnit] = useState('sqft');
  const [lengthValue, setLengthValue] = useState('40');
  const [widthValue, setWidthValue] = useState('60');
  const [lengthUnit, setLengthUnit] = useState('ft');
  const [hindiInput, setHindiInput] = useState('');
  const [urduInput, setUrduInput] = useState('');
  const [englishInput, setEnglishInput] = useState('');
  const [calcExpression, setCalcExpression] = useState('');
  const [calcResult, setCalcResult] = useState('0');
  const [toolTab, setToolTab] = useState('basic');

  const runCalculator = (expression = calcExpression) => {
    try {
      const cleaned = String(expression)
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .replace(/−/g, '-')
        .replace(/%/g, '/100')
        .replace(/[^0-9+\-*/().\s]/g, '');
      if (!cleaned.trim()) { setCalcResult('0'); return; }
      const value = Function(`"use strict"; return (${cleaned})`)();
      setCalcResult(Number.isFinite(value) ? String(Number(value.toFixed(8))) : 'Invalid');
    } catch (e) {
      setCalcResult('Invalid');
    }
  };

  const addCalcToken = (token) => {
    if (calcResult === 'Invalid' && /[0-9.]/.test(token)) setCalcResult('0');
    setCalcExpression(prev => prev + token);
  };

  const backspaceCalc = () => setCalcExpression(prev => prev.slice(0, -1));
  const clearCalc = () => { setCalcExpression(''); setCalcResult('0'); };

  const keypadRows = [
    [
      { label: 'AC', action: clearCalc, tone: 'danger' },
      { label: '⌫', action: backspaceCalc, tone: 'soft' },
      { label: '( )', action: () => addCalcToken(calcExpression.includes('(') && !calcExpression.endsWith('(') ? ')' : '('), tone: 'soft' },
      { label: '%', token: '%', tone: 'operator' }
    ],
    [
      { label: '7', token: '7' }, { label: '8', token: '8' }, { label: '9', token: '9' }, { label: '÷', token: '÷', tone: 'operator' }
    ],
    [
      { label: '4', token: '4' }, { label: '5', token: '5' }, { label: '6', token: '6' }, { label: '×', token: '×', tone: 'operator' }
    ],
    [
      { label: '1', token: '1' }, { label: '2', token: '2' }, { label: '3', token: '3' }, { label: '−', token: '−', tone: 'operator' }
    ],
    [
      { label: '0', token: '0' }, { label: '.', token: '.' }, { label: '=', action: () => runCalculator(), tone: 'equals' }, { label: '+', token: '+', tone: 'operator' }
    ]
  ];

  const digitRows = [
    { hi: '०', ur: '۰', en: '0' }, { hi: '१', ur: '۱', en: '1' }, { hi: '२', ur: '۲', en: '2' }, { hi: '३', ur: '۳', en: '3' }, { hi: '४', ur: '۴', en: '4' },
    { hi: '५', ur: '۵', en: '5' }, { hi: '६', ur: '۶', en: '6' }, { hi: '७', ur: '۷', en: '7' }, { hi: '८', ur: '۸', en: '8' }, { hi: '९', ur: '۹', en: '9' }
  ];
  const hindiDigitRows = digitRows.map(row => [row.hi, row.en]);

  const englishToHindiDigits = (input = '') => String(input).split('').map(ch => {
    const row = digitRows.find(row => row.en === ch);
    return row ? row.hi : ch;
  }).join('');
  const englishToUrduDigits = (input = '') => String(input).split('').map(ch => {
    const row = digitRows.find(row => row.en === ch);
    return row ? row.ur : ch;
  }).join('');

  const convertHindiDigitsOnly = (input = '') => String(input).split('').map(ch => hindiDigitMap[ch] ?? ch).join('');

  const numericValue = Number(parseHindiNumber(value)) || 0;
  const converted = numericValue * (areaFactorsToSqft[fromUnit] || 1) / (areaFactorsToSqft[toUnit] || 1);
  const hindiConverted = convertHindiDigitsOnly(hindiInput);
  const urduConverted = convertHindiDigitsOnly(urduInput);
  const englishToHindiConverted = englishToHindiDigits(englishInput);
  const englishToUrduConverted = englishToUrduDigits(englishInput);

  const lengthToFeet = { ft: 1, m: 3.280839895, inch: 1/12, yard: 3 };
  const lengthLabels = { ft: 'Feet', m: 'Metre', inch: 'Inch', yard: 'Yard' };
  const lengthFt = (Number(parseHindiNumber(lengthValue)) || 0) * (lengthToFeet[lengthUnit] || 1);
  const widthFt = (Number(parseHindiNumber(widthValue)) || 0) * (lengthToFeet[lengthUnit] || 1);
  const areaSqft = lengthFt * widthFt;
  const areaSqmt = areaSqft / areaFactorsToSqft.sqmt;
  const areaAcre = areaSqft / areaFactorsToSqft.acre;
  const areaHectare = areaSqft / areaFactorsToSqft.hectare;

  const quickRows = [
    ['1 Hectare', 'Sqft', (1 * areaFactorsToSqft.hectare).toLocaleString('en-IN')],
    ['1 Acre', 'Sqft', areaFactorsToSqft.acre.toLocaleString('en-IN')],
    ['1 Bigha UP', 'Sqft', areaFactorsToSqft.bigha_up.toLocaleString('en-IN')],
    ['1 Biswa UP', 'Sqft', areaFactorsToSqft.biswa_up.toLocaleString('en-IN')]
  ];

  const keyClass = (tone) => {
    if (tone === 'equals') return 'bg-slate-900 text-white shadow-lg shadow-slate-900/15 active:scale-[0.98]';
    if (tone === 'operator') return 'bg-indigo-50 text-indigo-700 active:bg-indigo-100';
    if (tone === 'danger') return 'bg-red-50 text-red-600 active:bg-red-100';
    if (tone === 'soft') return 'bg-slate-100 text-slate-600 active:bg-slate-200';
    return 'bg-slate-100 text-slate-900 active:bg-slate-200';
  };

  return (
    <div className="calculator-page space-y-4 sm:space-y-6 animate-in fade-in duration-200 pb-24 md:pb-6">
      <div className="hidden sm:block">
        <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Calculator & Conversion Tools</h1>
        <p className="text-slate-500 font-medium mt-2">Area calculator, land measurement converter, Hindi digit guide, and quick estimate tools for everyone.</p>
      </div>

      <div className="bg-white rounded-[1.7rem] sm:rounded-3xl border-2 border-slate-100 p-4 sm:p-6 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 mb-4 sm:mb-5">
          <h2 className="text-lg sm:text-xl font-black text-slate-800 flex items-center"><LayoutDashboard className="w-5 h-5 mr-2 text-slate-700" /> Simple Calculator</h2>
          <button type="button" onClick={() => navigator.clipboard?.writeText(String(calcResult))} className="hidden sm:inline-flex bg-slate-900 text-white rounded-2xl px-4 py-2 text-xs font-black">Copy Result</button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-3">
            <div className="calculator-display sticky top-2 z-10 bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-[1.4rem] sm:rounded-3xl p-4 sm:p-6 shadow-lg mb-4">
              <label className="text-[10px] sm:text-xs font-black text-indigo-200 uppercase tracking-widest block mb-2">Expression</label>
              <input
                value={calcExpression}
                onChange={e => setCalcExpression(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runCalculator(); } }}
                placeholder="1250 + 18%"
                className="w-full bg-white/10 border border-white/10 rounded-2xl px-3 py-3 text-white placeholder:text-white/40 font-black text-xl sm:text-2xl outline-none focus:border-white/30"
              />
              <div className="flex items-end justify-between gap-3 mt-4">
                <p className="text-[10px] sm:text-xs font-black text-indigo-200 uppercase tracking-widest">Result</p>
                <p className="text-3xl sm:text-5xl font-black text-right break-all leading-none">{calcResult}</p>
              </div>
            </div>

            <div
              className="calculator-keypad"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: '0.5rem',
                width: '100%',
                alignItems: 'stretch'
              }}
            >
              {keypadRows.flat().map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  onClick={() => btn.action ? btn.action() : addCalcToken(btn.token)}
                  className={`${keyClass(btn.tone)} calculator-key rounded-2xl sm:rounded-[1.35rem] font-black text-lg sm:text-xl transition-transform touch-manipulation`}
                  style={{
                    width: '100%',
                    minWidth: 0,
                    height: 'clamp(3.25rem, 12.2vw, 4rem)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            <div
              className="calculator-quick-actions"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: '0.5rem',
                marginTop: '0.75rem'
              }}
            >
              {[['+18%', '+18%'], ['-18%', '-18%'], ['Half', '/2'], ['Double', '*2']].map(([label, token]) => (
                <button key={label} type="button" onClick={() => addCalcToken(token)} className="bg-white border border-slate-100 px-2 py-2.5 rounded-2xl text-xs font-black text-slate-600 active:bg-slate-50 transition-colors" style={{ width: '100%', minWidth: 0 }}>{label}</button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2 hidden lg:flex bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-3xl p-6 flex-col justify-between min-h-[220px] shadow-lg">
            <div>
              <p className="text-xs font-black text-indigo-200 uppercase tracking-widest">Result</p>
              <p className="text-5xl font-black mt-4 break-all">{calcResult}</p>
            </div>
            <button type="button" onClick={() => navigator.clipboard?.writeText(String(calcResult))} className="mt-6 bg-white/10 hover:bg-white/20 border border-white/10 text-white rounded-2xl py-3 font-black transition-colors">Copy Result</button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[1.7rem] sm:rounded-3xl border-2 border-slate-100 p-3 sm:p-6 shadow-sm">
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            ['basic', 'Basic'], ['land', 'Land'], ['civil', 'Civil']
          ].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setToolTab(id)} className={`${toolTab === id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'} rounded-2xl py-3 text-sm font-black transition-colors`}>{label}</button>
          ))}
        </div>

        {toolTab === 'basic' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
              <div>
                <h2 className="text-lg sm:text-xl font-black text-slate-800">Hindi / Urdu / English Digit Tools</h2>
                <p className="text-xs sm:text-sm font-bold text-slate-400 mt-1">Compact reference and instant converter for Devanagari, Urdu and English numerals.</p>
              </div>
              <button type="button" onClick={() => navigator.clipboard?.writeText(digitRows.map(row => `${row.hi}  ${row.ur}  ${row.en}`).join('\n'))} className="w-fit rounded-xl bg-slate-900 text-white px-3 py-2 text-xs font-black">Copy Chart</button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
              <div className="grid grid-cols-3 bg-slate-50 text-[10px] sm:text-xs font-black uppercase tracking-widest text-slate-400">
                <div className="px-3 py-2 text-center">Hindi</div>
                <div className="px-3 py-2 text-center">Urdu</div>
                <div className="px-3 py-2 text-center">English</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
                {digitRows.map(row => (
                  <button key={row.en} type="button" onClick={() => navigator.clipboard?.writeText(`${row.hi} ${row.ur} ${row.en}`)} className="grid grid-cols-3 items-center py-3 px-2 hover:bg-indigo-50 active:bg-indigo-100 transition-colors" title="Click to copy">
                    <span className="text-2xl font-black text-slate-800">{row.hi}</span>
                    <span className="text-2xl font-black text-slate-800">{row.ur}</span>
                    <span className="text-lg font-black text-indigo-700">{row.en}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Hindi digits to English</label>
                <textarea value={hindiInput} onChange={e => setHindiInput(e.target.value)} rows={3} placeholder="Example: १२३४५६७८९०" className="w-full border-2 border-slate-100 rounded-2xl p-3 font-bold outline-none focus:border-indigo-500 resize-none" />
                <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 mt-3"><p className="text-xs text-indigo-600 font-black uppercase tracking-widest">English output</p><p className="text-2xl font-black text-indigo-800 mt-1 break-all">{hindiConverted || '-'}</p></div>
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Urdu digits to English</label>
                <textarea value={urduInput} onChange={e => setUrduInput(e.target.value)} rows={3} placeholder="Example: ۱۲۳۴۵۶۷۸۹۰" className="w-full border-2 border-slate-100 rounded-2xl p-3 font-bold outline-none focus:border-purple-500 resize-none" />
                <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4 mt-3"><p className="text-xs text-purple-600 font-black uppercase tracking-widest">English output</p><p className="text-2xl font-black text-purple-800 mt-1 break-all">{urduConverted || '-'}</p></div>
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">English digits to Hindi + Urdu</label>
                <textarea value={englishInput} onChange={e => setEnglishInput(e.target.value)} rows={3} placeholder="Example: 1234567890" className="w-full border-2 border-slate-100 rounded-2xl p-3 font-bold outline-none focus:border-emerald-500 resize-none" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                  <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4"><p className="text-xs text-emerald-600 font-black uppercase tracking-widest">Hindi</p><p className="text-2xl font-black text-emerald-800 mt-1 break-all">{englishToHindiConverted || '-'}</p></div>
                  <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4"><p className="text-xs text-amber-600 font-black uppercase tracking-widest">Urdu</p><p className="text-2xl font-black text-amber-800 mt-1 break-all">{englishToUrduConverted || '-'}</p></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {toolTab === 'land' && (
          <div className="space-y-4">
            <h2 className="text-lg sm:text-xl font-black text-slate-800 flex items-center"><MapIcon className="w-5 h-5 mr-2 text-indigo-500" /> Area & Land Unit Converter</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Value</label>
                <input value={value} onChange={e => setValue(e.target.value)} className="w-full border-2 border-slate-100 rounded-2xl p-3 font-black outline-none focus:border-indigo-500" placeholder="Enter area" />
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">From</label>
                <select value={fromUnit} onChange={e => setFromUnit(e.target.value)} className="w-full border-2 border-slate-100 rounded-2xl p-3 font-bold bg-white outline-none focus:border-indigo-500">
                  {Object.keys(areaFactorsToSqft).map(k => <option key={k} value={k}>{areaLabels[k]}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">To</label>
                <select value={toUnit} onChange={e => setToUnit(e.target.value)} className="w-full border-2 border-slate-100 rounded-2xl p-3 font-bold bg-white outline-none focus:border-indigo-500">
                  {Object.keys(areaFactorsToSqft).map(k => <option key={k} value={k}>{areaLabels[k]}</option>)}
                </select>
              </div>
            </div>
            <div className="bg-indigo-50 border-2 border-indigo-100 rounded-3xl p-5">
              <p className="text-xs text-indigo-500 font-black uppercase tracking-widest">Converted result</p>
              <p className="text-3xl sm:text-4xl font-black text-indigo-800 mt-2">{converted.toLocaleString('en-IN', { maximumFractionDigits: 4 })}</p>
              <p className="text-sm font-bold text-indigo-600 mt-2">{areaLabels[toUnit]}</p>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {quickRows.map(([a,b,c]) => <div key={a} className="bg-slate-50 rounded-2xl p-4 border border-slate-100"><p className="font-black text-slate-800 text-sm">{a}</p><p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">in {b}</p><p className="text-xl text-indigo-700 font-black mt-2">{c}</p></div>)}
            </div>
          </div>
        )}

        {toolTab === 'civil' && (
          <div className="space-y-4">
            <h2 className="text-lg sm:text-xl font-black text-slate-800 flex items-center"><LayoutDashboard className="w-5 h-5 mr-2 text-emerald-500" /> Length × Width Calculator</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Length</label>
                <input value={lengthValue} onChange={e => setLengthValue(e.target.value)} className="w-full border-2 border-slate-100 rounded-2xl p-3 font-black outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Width</label>
                <input value={widthValue} onChange={e => setWidthValue(e.target.value)} className="w-full border-2 border-slate-100 rounded-2xl p-3 font-black outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Unit</label>
                <select value={lengthUnit} onChange={e => setLengthUnit(e.target.value)} className="w-full border-2 border-slate-100 rounded-2xl p-3 font-bold bg-white outline-none focus:border-emerald-500">
                  {Object.keys(lengthToFeet).map(k => <option key={k} value={k}>{lengthLabels[k]}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4"><p className="text-xs font-black text-emerald-600 uppercase tracking-widest">Sq ft</p><p className="text-xl sm:text-2xl font-black text-emerald-800">{areaSqft.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p></div>
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4"><p className="text-xs font-black text-blue-600 uppercase tracking-widest">Sq mt</p><p className="text-xl sm:text-2xl font-black text-blue-800">{areaSqmt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p></div>
              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4"><p className="text-xs font-black text-amber-600 uppercase tracking-widest">Acre</p><p className="text-xl sm:text-2xl font-black text-amber-800">{areaAcre.toLocaleString('en-IN', { maximumFractionDigits: 5 })}</p></div>
              <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4"><p className="text-xs font-black text-purple-600 uppercase tracking-widest">Hectare</p><p className="text-xl sm:text-2xl font-black text-purple-800">{areaHectare.toLocaleString('en-IN', { maximumFractionDigits: 5 })}</p></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
