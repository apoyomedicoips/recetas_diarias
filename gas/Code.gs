/**
 * Backend para tablero de recetas diarias.
 * Lee archivos CSV/TXT publicados en el repositorio público:
 *   https://github.com/apoyomedicoips/recetas_diarias
 *
 * Exponer como Web App:
 *   - Ejecutar como: Usted
 *   - Quién tiene acceso: Cualquiera con el enlace
 */

const CONFIG = {
  REPO_RAW_BASE: "https://raw.githubusercontent.com/apoyomedicoips/recetas_diarias/main/",
  FILE_ALMACENES: "almacenes_farmacias_codigos.csv",
  FILE_MEDICAMENTOS: "descripcionycodigomedicacmentoSAP.csv",
  FILE_USUARIOS: "usuarios.csv",
  // particiones de recetas SOLO esenciales 2025 en GitHub
  RECETAS_PART_PREFIX: "recetas_por_mes_anio_medicamento_soloesenciales_2025_",
  RECETAS_PART_SUFFIX: ".txt",
  RECETAS_PART_MIN: 1,
  RECETAS_PART_MAX: 12,
  CACHE_SECONDS: 30 * 60
};

// ======================= Punto de entrada =======================

function doGet(e){
  const params = e && e.parameter ? e.parameter : {};
  const action = (params.action || "ping").toString().toLowerCase();

  let payload;

  try{
    if(action === "login"){
      payload = apiLogin(params);
    } else if(action === "metadata"){
      payload = apiMetadata(params);
    } else if(action === "summary"){
      payload = apiSummary(params);
    } else {
      payload = { ok:true, action:"ping", message:"API recetas_diarias activa" };
    }
  } catch(err){
    payload = { ok:false, error:String(err), stack:String(err.stack || "") };
  }

  return ContentService
    .createTextOutput(JSON.stringify(payload, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

// ======================= Lectura y cacheo de CSV/TXT desde GitHub =======================

/**
 * Descarga un archivo de texto (CSV/TXT) desde GitHub RAW y lo cachea.
 */
function fetchCsvText(fileName){
  const cache = CacheService.getScriptCache();
  const key = "csv_" + fileName;
  let txt = cache.get(key);
  if(txt){
    return txt;
  }

  const url = CONFIG.REPO_RAW_BASE + fileName;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions:true });
  const code = res.getResponseCode();
  if(code !== 200){
    throw new Error("No se pudo leer " + fileName + " (HTTP " + code + ")");
  }
  txt = res.getContentText("UTF-8");
  cache.put(key, txt, CONFIG.CACHE_SECONDS);
  return txt;
}

/**
 * Convierte un CSV en arreglo de objetos {columna: valor}.
 * Usa la primera fila como encabezados.
 */
function parseCsv(text){
  const rows = Utilities.parseCsv(text);
  if(!rows || rows.length === 0){
    return [];
  }
  const headers = rows[0].map(function(h){ return (h || "").trim(); });
  const data = [];
  for(var i=1; i<rows.length; i++){
    var row = rows[i];
    if(!row || row.join("").trim() === ""){
      continue;
    }
    var obj = {};
    for(var j=0; j<headers.length; j++){
      var key = headers[j];
      if(!key){
        continue;
      }
      obj[key] = row[j] !== undefined ? row[j] : "";
    }
    data.push(obj);
  }
  return data;
}

function getUsuarios(){
  const txt = fetchCsvText(CONFIG.FILE_USUARIOS);
  return parseCsv(txt);
}

function getAlmacenes(){
  const txt = fetchCsvText(CONFIG.FILE_ALMACENES);
  return parseCsv(txt);
}

function getMedicamentos(){
  const txt = fetchCsvText(CONFIG.FILE_MEDICAMENTOS);
  return parseCsv(txt);
}

/**
 * Concatena las particiones de recetas:
 *   recetas_por_mes_anio_medicamento_soloesenciales_2025_1.txt
 *   ...
 *   recetas_por_mes_anio_medicamento_soloesenciales_2025_12.txt
 */
function getRecetas(){
  var all = [];

  for(var k = CONFIG.RECETAS_PART_MIN; k <= CONFIG.RECETAS_PART_MAX; k++){
    var fname = CONFIG.RECETAS_PART_PREFIX + String(k) + CONFIG.RECETAS_PART_SUFFIX;
    try{
      var txt = fetchCsvText(fname);
      var arr = parseCsv(txt);
      if(arr && arr.length){
        Array.prototype.push.apply(all, arr);
      }
    } catch(e){
      // Si algún archivo no existe u otro error, se ignora esa partición
      Logger.log("No se pudo leer " + fname + ": " + e);
    }
  }

  return all;
}

// ======================= API: login =======================

function apiLogin(params){
  var usuario = (params.usuario || "").toString().trim();
  var clave = (params.clave || "").toString().trim();

  if(!usuario || !clave){
    return { ok:false, message:"Usuario y contraseña son obligatorios." };
  }

  var usuarios = getUsuarios();
  var match = null;
  for(var i=0; i<usuarios.length; i++){
    var u = usuarios[i];
    if(String(u.usuario || "").trim() === usuario &&
       String(u.clave   || "").trim() === clave){
      match = u;
      break;
    }
  }

  if(!match){
    return { ok:false, message:"Credenciales inválidas." };
  }

  return {
    ok:true,
    usuario:usuario,
    nombre: match.nombre || usuario,
    rol: match.rol || "usuario"
  };
}

// ======================= API: metadata =======================

function apiMetadata(params){
  var recetas = getRecetas();
  var almacenes = getAlmacenes();
  var meds = getMedicamentos();

  // Diccionarios
  var mapFarm = {};
  almacenes.forEach(function(a){
    if(!a.codigoalmacen){ return; }
    mapFarm[String(a.codigoalmacen)] = a.denominacionalmacen || "";
  });

  var mapMed = {};
  meds.forEach(function(m){
    if(!m.medicamentosap){ return; }
    var desc = m.med_std || m.textobrevemedicamento || "";
    mapMed[String(m.medicamentosap)] = desc;
  });

  var farmaciasSet = {};
  var medsSet = {};
  var minDate = null;
  var maxDate = null;

  recetas.forEach(function(r){
    var f = String(r.codigofarmaciavent || "").trim();
    if(f){
      farmaciasSet[f] = true;
    }
    var m = String(r.medicamentosap || "").trim();
    if(m){
      medsSet[m] = true;
    }
    var d = parseFecha(r.fechanecesidad);
    if(d){
      if(!minDate || d.getTime() < minDate.getTime()) minDate = d;
      if(!maxDate || d.getTime() > maxDate.getTime()) maxDate = d;
    }
  });

  var farmacias = Object.keys(farmaciasSet).sort().map(function(c){
    return { codigo:c, nombre:(mapFarm[c] || "") };
  });

  var medsArr = Object.keys(medsSet).sort().map(function(c){
    return { codigo:c, nombre:(mapMed[c] || "") };
  });

  return {
    ok:true,
    farmacias:farmacias,
    medicamentos:medsArr,
    fechas:{
      min: minDate ? formatDateISO(minDate) : null,
      max: maxDate ? formatDateISO(maxDate) : null
    }
  };
}

// ======================= API: summary =======================

function apiSummary(params){
  var filtros = {
    fechaDesde: parseFecha(params.fechaDesde),
    fechaHasta: parseFecha(params.fechaHasta),
    farmacia: (params.farmacia || "").trim(),
    medicamento: (params.medicamento || "").trim(),
    soloEsenciales: String(params.soloEsenciales || "") === "1",
    umbralCritico: Number(params.umbralCritico || 7)
  };
  if(!filtros.umbralCritico || filtros.umbralCritico <= 0){
    filtros.umbralCritico = 7;
  }

  var recetas = getRecetas();
  var almacenes = getAlmacenes();
  var meds = getMedicamentos();

  // Diccionarios
  var mapFarm = {};
  almacenes.forEach(function(a){
    if(!a.codigoalmacen){ return; }
    mapFarm[String(a.codigoalmacen)] = a.denominacionalmacen || "";
  });

  var mapMed = {};
  var mapMedEsencial = {};
  meds.forEach(function(m){
    if(!m.medicamentosap){ return; }
    var code = String(m.medicamentosap);
    var desc = m.med_std || m.textobrevemedicamento || "";
    mapMed[code] = desc;
    var es = String(m.esencial || "").toLowerCase();
    mapMedEsencial[code] = (es === "esencial" || es === "sí" || es === "si");
  });

  // Acumuladores globales
  var k_totalRec = 0;
  var k_totalDisp = 0;
  var k_totalQuiebresDias = 0;
  var k_totalDiasConDemanda = 0;

  var fechaMin = null;
  var fechaMax = null;

  // Agrupadores
  var porDia = {};              // fecha -> {rec, disp}
  var porFarm = {};             // farmacia -> {...}
  var porFarmMed = {};          // key=farm|med -> {...}

  recetas.forEach(function(r){
    var fCode = String(r.codigofarmaciavent || "").trim();
    var mCode = String(r.medicamentosap || "").trim();
    var fecha = parseFecha(r.fechanecesidad);
    if(!fecha){ return; }

    if(filtros.fechaDesde && fecha < filtros.fechaDesde){ return; }
    if(filtros.fechaHasta && fecha > filtros.fechaHasta){ return; }
    if(filtros.farmacia && fCode !== filtros.farmacia){ return; }
    if(filtros.medicamento && mCode !== filtros.medicamento){ return; }

    var qtyRec = toNumber(r.cantidadrecetada);
    var qtyDisp = toNumber(r.cantidadyadispensada);
    var stock = toNumber(r.stockenfarmaciaventanilla);
    var insumoesencial = toNumber(r.insumoesencial);
    var esencialFlag = !!insumoesencial || !!mapMedEsencial[mCode];

    if(filtros.soloEsenciales && !esencialFlag){
      return;
    }

    // Actualizar rango de fechas
    if(!fechaMin || fecha.getTime() < fechaMin.getTime()) fechaMin = fecha;
    if(!fechaMax || fecha.getTime() > fechaMax.getTime()) fechaMax = fecha;

    // Claves
    var fechaKey = formatDateISO(fecha);
    var farmDesc = (mapFarm[fCode] || "");
    var medDesc = (mapMed[mCode] || "");

    // Serie diaria global
    if(!porDia[fechaKey]){
      porDia[fechaKey] = { rec:0, disp:0 };
    }
    porDia[fechaKey].rec += qtyRec;
    porDia[fechaKey].disp += qtyDisp;

    // Farmacia
    if(!porFarm[fCode]){
      porFarm[fCode] = {
        farmacia: fCode + (farmDesc ? " - " + farmDesc : ""),
        dias_observados:0,
        recetado:0,
        dispensado:0,
        quiebres:0,
        _dias_con_demanda:0,
        _fechas:{}
      };
    }
    var pf = porFarm[fCode];
    pf.recetado += qtyRec;
    pf.dispensado += qtyDisp;
    if(!pf._fechas[fechaKey]){
      pf._fechas[fechaKey] = { rec:0, disp:0, quiebre:false };
    }
    var pfDia = pf._fechas[fechaKey];
    pfDia.rec += qtyRec;
    pfDia.disp += qtyDisp;

    // Farmacia + medicamento
    var keyFM = fCode + "|" + mCode;
    if(!porFarmMed[keyFM]){
      porFarmMed[keyFM] = {
        farmaciaCodigo: fCode,
        farmacia: fCode + (farmDesc ? " - " + farmDesc : ""),
        medicamentoCodigo: mCode,
        medicamento: mCode + (medDesc ? " - " + medDesc : ""),
        esencial: esencialFlag,
        stockUltimo: stock,
        fechaUltima: fecha,
        sumRec:0,
        sumDisp:0,
        dias:0,
        quiebresDias:0,
        _fechas:{}
      };
    }
    var g = porFarmMed[keyFM];
    g.sumRec += qtyRec;
    g.sumDisp += qtyDisp;
    if(!g._fechas[fechaKey]){
      g._fechas[fechaKey] = { rec:0, disp:0, stock:stock };
      g.dias++;
    }
    g._fechas[fechaKey].rec += qtyRec;
    g._fechas[fechaKey].disp += qtyDisp;
    g._fechas[fechaKey].stock = stock;

    if(!g.fechaUltima || fecha.getTime() > g.fechaUltima.getTime()){
      g.fechaUltima = fecha;
      g.stockUltimo = stock;
    }
  });

  // Procesar quiebres
  Object.keys(porFarm).forEach(function(fCode){
    var pf = porFarm[fCode];
    var fechas = Object.keys(pf._fechas);
    pf.dias_observados = fechas.length;
    fechas.forEach(function(d){
      var dia = pf._fechas[d];
      if(dia.rec > 0){
        pf._dias_con_demanda++;
        k_totalDiasConDemanda++;
        if(dia.disp < dia.rec){
          pf.quiebres++;
          k_totalQuiebresDias++;
        }
      }
    });
    k_totalRec += pf.recetado;
    k_totalDisp += pf.dispensado;
    pf.tasa_quiebre = pf._dias_con_demanda > 0 ? pf.quiebres / pf._dias_con_demanda : 0;
    pf.fill_rate_global = pf.recetado > 0 ? pf.dispensado / pf.recetado : 0;
  });

  var tasaQuiebreGlobal = k_totalDiasConDemanda > 0 ? k_totalQuiebresDias / k_totalDiasConDemanda : 0;

  // Serie diaria ordenada
  var fechasSerie = Object.keys(porDia).sort();
  var serie = {
    fechas: fechasSerie,
    recetado: [],
    dispensado: []
  };
  fechasSerie.forEach(function(d){
    serie.recetado.push(porDia[d].rec);
    serie.dispensado.push(porDia[d].disp);
  });

  // Top medicamentos
  var porMed = {};
  Object.keys(porFarmMed).forEach(function(keyFM){
    var g = porFarmMed[keyFM];
    var mCode = g.medicamentoCodigo;
    if(!porMed[mCode]){
      porMed[mCode] = {
        codigo: mCode,
        medicamento: g.medicamento,
        dispensado:0
      };
    }
    porMed[mCode].dispensado += g.sumDisp;
  });
  var topMeds = Object.keys(porMed).map(function(k){
    return porMed[k];
  }).sort(function(a,b){
    return (b.dispensado||0) - (a.dispensado||0);
  }).slice(0, 10);

  // Stock crítico
  var itemsCriticos = 0;
  var stockCritico = [];
  Object.keys(porFarmMed).forEach(function(keyFM){
    var g = porFarmMed[keyFM];
    if(!g.dias || g.sumDisp <= 0){
      return;
    }
    var consumoDiario = g.sumDisp / g.dias;
    if(consumoDiario <= 0){
      return;
    }
    var cobertura = g.stockUltimo > 0 ? g.stockUltimo / consumoDiario : 0;
    var critico = cobertura > 0 && cobertura <= filtros.umbralCritico;
    if(critico){
      itemsCriticos++;
    }
    stockCritico.push({
      farmacia: g.farmacia,
      medicamento: g.medicamento,
      stock_ult: g.stockUltimo,
      consumo_diario: consumoDiario,
      dias_cobertura: cobertura,
      reposicion_requerida: Math.max(0, filtros.umbralCritico * consumoDiario - (g.stockUltimo || 0))
    });
  });

  stockCritico.sort(function(a,b){
    return (a.dias_cobertura || 0) - (b.dias_cobertura || 0);
  });
  stockCritico = stockCritico.slice(0, 50);

  var quiebresFarmacia = Object.keys(porFarm).map(function(fCode){
    var pf = porFarm[fCode];
    return {
      farmacia: pf.farmacia,
      dias_observados: pf.dias_observados,
      recetado: pf.recetado,
      dispensado: pf.dispensado,
      quiebres: pf.quiebres,
      tasa_quiebre: pf.tasa_quiebre,
      fill_rate_global: pf.fill_rate_global
    };
  }).sort(function(a,b){
    return (b.tasa_quiebre || 0) - (a.tasa_quiebre || 0);
  });

  return {
    ok:true,
    kpis:{
      total_recetado: k_totalRec,
      total_dispensado: k_totalDisp,
      tasa_quiebre: tasaQuiebreGlobal,
      items_criticos: itemsCriticos
    },
    fechas:{
      min: fechaMin ? formatDateISO(fechaMin) : null,
      max: fechaMax ? formatDateISO(fechaMax) : null
    },
    series: serie,
    top_meds: topMeds,
    stock_critico: stockCritico,
    quiebres_farmacia: quiebresFarmacia
  };
}

// ======================= Utilidades varias =======================

function parseFecha(str){
  if(!str){ return null; }
  var s = String(str).trim();
  if(!s){ return null; }
  var parts = s.split(/[T ]/)[0].split("-");
  if(parts.length !== 3){ return null; }
  var y = Number(parts[0]);
  var m = Number(parts[1]) - 1;
  var d = Number(parts[2]);
  if(!y || (!m && m !== 0) || !d){
    return null;
  }
  return new Date(y, m, d);
}

function formatDateISO(d){
  var y = d.getFullYear();
  var m = ("0" + (d.getMonth()+1)).slice(-2);
  var da = ("0" + d.getDate()).slice(-2);
  return y + "-" + m + "-" + da;
}

function toNumber(x){
  if(x === null || x === undefined){
    return 0;
  }
  var s = String(x).trim();
  if(!s){
    return 0;
  }
  s = s.replace(",", ".");
  var n = Number(s);
  return isNaN(n) ? 0 : n;
}
