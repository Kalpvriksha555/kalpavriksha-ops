import React, { useState } from 'react';
import { LayoutDashboard, Map as MapIcon } from 'lucide-react';

const hindiDigitMap = {
  '०':'0','१':'1','२':'2','३':'3','४':'4','५':'5','६':'6','७':'7','८':'8','९':'9',
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
  const [englishInput, setEnglishInput] = useState('');
  const [calcExpression, setCalcExpression] = useState('');
  const [calcResult, setCalcResult] = useState('0');

  const runCalculator = (expression = calcExpression) => {
    try {
      const cleaned = String(expression)
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .replace(/−/g, '-')
        .replace(/%/g, '/100')
        .replace(/[^0-9+\-*/().\s]/g, '');
      if (!cleaned.trim()) { setCalcResult('0'); return; }
      // Safe because all non-numeric/operator characters are removed above.
      const value = Function(`"use strict"; return (${cleaned})`)();
      setCalcResult(Number.isFinite(value) ? String(Number(value.toFixed(8))) : 'Invalid');
    } catch (e) {
      setCalcResult('Invalid');
    }
  };

  const addCalcToken = (token) => {
    const next = calcExpression + token;
    setCalcExpression(next);
  };

  const hindiDigitRows = [
    ['०', '0'], ['१', '1'], ['२', '2'], ['३', '3'], ['४', '4'],
    ['५', '5'], ['६', '6'], ['७', '7'], ['८', '8'], ['९', '9']
  ];

  const englishToHindiDigits = (input = '') => String(input).split('').map(ch => {
    const row = hindiDigitRows.find(([, en]) => en === ch);
    return row ? row[0] : ch;
  }).join('');

  const convertHindiDigitsOnly = (input = '') => String(input).split('').map(ch => hindiDigitMap[ch] ?? ch).join('');

  const numericValue = Number(parseHindiNumber(value)) || 0;
  const converted = numericValue * (areaFactorsToSqft[fromUnit] || 1) / (areaFactorsToSqft[toUnit] || 1);
  const hindiConverted = convertHindiDigitsOnly(hindiInput);
  const englishToHindiConverted = englishToHindiDigits(englishInput);

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

  return (
    <div className="space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Calculator & Conversion Tools</h1>
        <p className="text-slate-500 font-medium mt-2">Area calculator, land measurement converter, Hindi digit guide, and quick estimate tools for everyone.</p>
      </div>

      <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
        <h2 className="text-xl font-black text-slate-800 mb-5 flex items-center"><LayoutDashboard className="w-5 h-5 mr-2 text-slate-700" /> Simple Calculator</h2>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-3 space-y-4">
            <div>
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Expression</label>
              <input value={calcExpression} onChange={e => setCalcExpression(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runCalculator(); } }} placeholder="Example: 1250 + 18% or 40*60/2" className="w-full border-2 border-slate-100 rounded-2xl p-4 font-black text-lg outline-none focus:border-slate-700 bg-slate-50/50" />
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {['7','8','9','÷','%','(', '4','5','6','×','.',')', '1','2','3','−','+','C', '0','00','000','/','*','='].map(btn => (
                <button key={btn} type="button" onClick={() => { if (btn === 'C') { setCalcExpression(''); setCalcResult('0'); return; } if (btn === '=') { runCalculator(); return; } addCalcToken(btn); }} className={`${btn === '=' ? 'bg-slate-800 text-white hover:bg-slate-700' : btn === 'C' ? 'bg-red-50 text-red-600 hover:bg-red-100' : ['÷','×','−','+','/','*','%','(',')'].includes(btn) ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'} px-4 py-3 rounded-2xl font-black transition-colors`}>{btn}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[['+18%', '+18%'], ['-18%', '-18%'], ['Half', '/2'], ['Double', '*2']].map(([label, token]) => (
                <button key={label} type="button" onClick={() => addCalcToken(token)} className="bg-white border border-slate-100 px-4 py-2 rounded-xl text-xs font-black text-slate-600 hover:border-indigo-200 hover:text-indigo-700 transition-colors">{label}</button>
              ))}
            </div>
            <p className="text-xs text-slate-400 font-bold">Supports add, subtract, multiply, divide, brackets, decimals, percentage and quick GST-style percentage checks.</p>
          </div>
          <div className="lg:col-span-2 bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-3xl p-6 flex flex-col justify-between min-h-[220px] shadow-lg">
            <div>
              <p className="text-xs font-black text-indigo-200 uppercase tracking-widest">Result</p>
              <p className="text-5xl font-black mt-4 break-all">{calcResult}</p>
            </div>
            <button type="button" onClick={() => navigator.clipboard?.writeText(String(calcResult))} className="mt-6 bg-white/10 hover:bg-white/20 border border-white/10 text-white rounded-2xl py-3 font-black transition-colors">Copy Result</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-800 mb-5 flex items-center"><MapIcon className="w-5 h-5 mr-2 text-indigo-500" /> Area & Land Unit Converter</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div className="sm:col-span-1">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Value</label>
              <input value={value} onChange={e => setValue(e.target.value)} className="w-full border-2 border-slate-100 rounded-xl p-3 font-black outline-none focus:border-indigo-500" placeholder="Enter area" />
            </div>
            <div>
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">From</label>
              <select value={fromUnit} onChange={e => setFromUnit(e.target.value)} className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold bg-white outline-none focus:border-indigo-500">
                {Object.keys(areaFactorsToSqft).map(k => <option key={k} value={k}>{areaLabels[k]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">To</label>
              <select value={toUnit} onChange={e => setToUnit(e.target.value)} className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold bg-white outline-none focus:border-indigo-500">
                {Object.keys(areaFactorsToSqft).map(k => <option key={k} value={k}>{areaLabels[k]}</option>)}
              </select>
            </div>
          </div>
          <div className="bg-indigo-50 border-2 border-indigo-100 rounded-3xl p-6">
            <p className="text-xs text-indigo-500 font-black uppercase tracking-widest">Converted result</p>
            <p className="text-4xl font-black text-indigo-800 mt-2">{converted.toLocaleString('en-IN', { maximumFractionDigits: 4 })}</p>
            <p className="text-sm font-bold text-indigo-600 mt-2">{areaLabels[toUnit]}</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-800 mb-5 flex items-center"><LayoutDashboard className="w-5 h-5 mr-2 text-emerald-500" /> Length × Width Calculator</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div>
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Length</label>
              <input value={lengthValue} onChange={e => setLengthValue(e.target.value)} className="w-full border-2 border-slate-100 rounded-xl p-3 font-black outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Width</label>
              <input value={widthValue} onChange={e => setWidthValue(e.target.value)} className="w-full border-2 border-slate-100 rounded-xl p-3 font-black outline-none focus:border-emerald-500" />
            </div>
            <div>
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Unit</label>
              <select value={lengthUnit} onChange={e => setLengthUnit(e.target.value)} className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold bg-white outline-none focus:border-emerald-500">
                {Object.keys(lengthToFeet).map(k => <option key={k} value={k}>{lengthLabels[k]}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4"><p className="text-xs font-black text-emerald-600 uppercase tracking-widest">Sq ft</p><p className="text-2xl font-black text-emerald-800">{areaSqft.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p></div>
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4"><p className="text-xs font-black text-blue-600 uppercase tracking-widest">Sq mt</p><p className="text-2xl font-black text-blue-800">{areaSqmt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p></div>
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4"><p className="text-xs font-black text-amber-600 uppercase tracking-widest">Acre</p><p className="text-2xl font-black text-amber-800">{areaAcre.toLocaleString('en-IN', { maximumFractionDigits: 5 })}</p></div>
            <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4"><p className="text-xs font-black text-purple-600 uppercase tracking-widest">Hectare</p><p className="text-2xl font-black text-purple-800">{areaHectare.toLocaleString('en-IN', { maximumFractionDigits: 5 })}</p></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-800 mb-5">Hindi Digit Guide</h2>
          <p className="text-sm text-slate-500 font-medium mb-4">Use this chart to read Hindi numerals written in deeds, revenue records, khasra papers, maps, and technical reports.</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
            {hindiDigitRows.map(([hi, en]) => (
              <div key={hi} className="bg-slate-50 border border-slate-100 rounded-2xl p-4 text-center">
                <p className="text-4xl font-black text-slate-800">{hi}</p>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest mt-2">English</p>
                <p className="text-2xl font-black text-indigo-700">{en}</p>
              </div>
            ))}
          </div>
          <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Hindi digits to English</label>
          <textarea value={hindiInput} onChange={e => setHindiInput(e.target.value)} rows={3} placeholder="Example: १२३४५६७८९०" className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500 resize-none" />
          <div className="bg-indigo-50 border-2 border-indigo-100 rounded-3xl p-5 mt-4">
            <p className="text-xs text-indigo-600 font-black uppercase tracking-widest">English output</p>
            <p className="text-3xl font-black text-indigo-800 mt-2 break-all">{hindiConverted || '-'}</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-800 mb-5">English Digit to Hindi Digit</h2>
          <p className="text-sm text-slate-500 font-medium mb-4">Useful when entering numbers in the same style as Hindi land documents.</p>
          <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">English digits</label>
          <textarea value={englishInput} onChange={e => setEnglishInput(e.target.value)} rows={3} placeholder="Example: 1234567890" className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-emerald-500 resize-none" />
          <div className="bg-emerald-50 border-2 border-emerald-100 rounded-3xl p-5 mt-4">
            <p className="text-xs text-emerald-600 font-black uppercase tracking-widest">Hindi output</p>
            <p className="text-3xl font-black text-emerald-800 mt-2 break-all">{englishToHindiConverted || '-'}</p>
          </div>
          <div className="mt-6 bg-slate-50 rounded-2xl p-5 border border-slate-100">
            <h3 className="font-black text-slate-800 mb-3">Examples</h3>
            <div className="grid grid-cols-2 gap-3 text-sm font-bold">
              <div className="bg-white rounded-xl p-3 border border-slate-100">१२३ → <span className="text-indigo-700">123</span></div>
              <div className="bg-white rounded-xl p-3 border border-slate-100">४५६ → <span className="text-indigo-700">456</span></div>
              <div className="bg-white rounded-xl p-3 border border-slate-100">७८९ → <span className="text-indigo-700">789</span></div>
              <div className="bg-white rounded-xl p-3 border border-slate-100">१००० → <span className="text-indigo-700">1000</span></div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 shadow-sm">
        <h2 className="text-xl font-black text-slate-800 mb-4">Quick Reference</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickRows.map(([a,b,c]) => <div key={a} className="bg-slate-50 rounded-2xl p-4 border border-slate-100"><p className="font-black text-slate-800">{a}</p><p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">in {b}</p><p className="text-2xl text-indigo-700 font-black mt-2">{c}</p></div>)}
        </div>
      </div>
    </div>
  );
};
