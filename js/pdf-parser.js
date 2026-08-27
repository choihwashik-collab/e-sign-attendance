/**
 * js/pdf-parser.js
 * 부서별 명단 PDF 및 Excel/Text 파일 지능형 파싱 모듈
 */

const ListParser = {
  /**
   * PDF 파일로부터 텍스트를 추출하고 부서/이름 목록으로 파싱
   * @param {File} file - 업로드된 PDF 파일
   * @returns {Promise<Array<{department: string, name: string, position: string}>>}
   */
  async parsePdf(file) {
    if (!window.pdfjsLib) {
      throw new Error('PDF.js 라이브러리가 로드되지 않았습니다.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    let fullTextLines = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      // 텍스트 아이템들을 y좌표 기준으로 라인별 묶기
      const items = textContent.items;
      if (!items || items.length === 0) continue;

      let currentLineY = null;
      let currentLineText = '';
      
      for (const item of items) {
        const itemY = Math.round(item.transform[5]);
        if (currentLineY === null || Math.abs(currentLineY - itemY) > 5) {
          if (currentLineText.trim()) {
            fullTextLines.push(currentLineText.trim());
          }
          currentLineY = itemY;
          currentLineText = item.str + ' ';
        } else {
          currentLineText += item.str + ' ';
        }
      }
      if (currentLineText.trim()) {
        fullTextLines.push(currentLineText.trim());
      }
    }

    return this.parseTextLines(fullTextLines);
  },

  /**
   * Excel (xlsx, xls, csv) 파일 파싱
   * @param {File} file
   * @returns {Promise<Array<{department: string, name: string, position: string}>>}
   */
  async parseExcel(file) {
    if (!window.XLSX) {
      throw new Error('XLSX 라이브러리가 로드되지 않았습니다.');
    }

    const data = await file.arrayBuffer();
    const workbook = window.XLSX.read(data, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const jsonData = window.XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    const attendees = [];
    let currentDept = '일반';

    // 컬럼 인덱스 찾기 (부서, 성명/이름, 직급)
    let deptIdx = -1;
    let nameIdx = -1;
    let posIdx = -1;
    let startRow = 0;

    for (let r = 0; r < Math.min(jsonData.length, 5); r++) {
      const row = jsonData[r];
      if (!Array.isArray(row)) continue;
      
      row.forEach((cell, idx) => {
        const str = String(cell || '').trim();
        if (/부서|소속|과|팀|학급|학년/.test(str)) deptIdx = idx;
        if (/이름|성명|참석자|성 명/.test(str)) nameIdx = idx;
        if (/직급|직위|직책|구분/.test(str)) posIdx = idx;
      });

      if (nameIdx !== -1) {
        startRow = r + 1;
        break;
      }
    }

    for (let i = startRow; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!Array.isArray(row) || row.length === 0) continue;

      let dept = deptIdx !== -1 ? String(row[deptIdx] || '').trim() : '';
      let name = nameIdx !== -1 ? String(row[nameIdx] || '').trim() : '';
      let pos = posIdx !== -1 ? String(row[posIdx] || '').trim() : '';

      // 이름 인덱스를 못 찾았을 경우 일반 텍스트 분석
      if (nameIdx === -1) {
        const textRow = row.filter(Boolean).map(v => String(v).trim()).join(' ');
        const parsed = this.parseSingleLine(textRow, currentDept);
        if (parsed.isDept) {
          currentDept = parsed.department;
        } else if (parsed.name) {
          attendees.push(parsed);
        }
        continue;
      }

      if (dept) currentDept = dept;
      if (name && name !== '성명' && name !== '이름') {
        attendees.push({
          id: 'att_' + Math.random().toString(36).substr(2, 9),
          department: currentDept || '미지정',
          name: name.replace(/\s+/g, ''),
          position: pos || '참석자',
          isSigned: false,
          signatureData: null,
          signedAt: null
        });
      }
    }

    return attendees;
  },

  /**
   * 텍스트 라인 배열을 분석하여 부서 및 성명 목록 추출
   * @param {Array<string>} lines
   * @returns {Array<{department: string, name: string, position: string}>}
   */
  parseTextLines(lines) {
    const attendees = [];
    let currentDept = '기본부서';

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      // 머리글, 페이지 번호 등 불필요 라인 필터링
      if (/^(\d+\s*\/\s*\d+|페이지|연수|출석부|서명부|일시|장소|순번|연번|성명|부서|서명)\s*$/i.test(line)) {
        continue;
      }

      const parsed = this.parseSingleLine(line, currentDept);
      if (parsed.isDept) {
        currentDept = parsed.department;
      } else if (parsed.name) {
        attendees.push(parsed);
      }
    }

    return attendees;
  },

  /**
   * 단일 문자열 라인 분석
   */
  parseSingleLine(line, currentDept) {
    // 1. 부서 헤더 패턴 감지: [기획팀], <행정실>, 1. 교무부, ■ 총무팀, "부서: 마케팅부" 등
    const deptMatch = line.match(/^([\[<【■◆●▶\d\.\-\s]*)([\w가-힣]+(?:팀|부|실|과|원|소|센터|처|파트|학년|본부))([\]>】\s:]*)$/);
    if (deptMatch && deptMatch[2] && line.length < 20) {
      return { isDept: true, department: deptMatch[2].trim() };
    }

    // "부서명 : 인사팀" 같은 명시적 패턴
    const deptPrefixMatch = line.match(/(?:부서|소속)\s*[:：]\s*([\w가-힣]+)/);
    if (deptPrefixMatch) {
      return { isDept: true, department: deptPrefixMatch[1].trim() };
    }

    // 2. 참석자 데이터 행 분석 (예: "1 홍길동 대리", "기획팀 이순신 과장", "강감찬", "김철수(교사)")
    // 구분자(탭, 콤마, 공백) 분리
    const tokens = line.split(/[\t,;|]+|\s{2,}/).map(t => t.trim()).filter(Boolean);

    if (tokens.length >= 2) {
      let dept = currentDept;
      let name = '';
      let pos = '참석자';

      // 토큰 중 부서, 직급, 이름 분류
      for (const tok of tokens) {
        if (/^(부장|차장|과장|대리|주임|사원|팀장|실장|교사|교감|교장|수석|주무관|연구원|선임|책임|원장|위원)$/.test(tok)) {
          pos = tok;
        } else if (/(?:팀|부|실|과|원|센터)$/.test(tok) && tok.length <= 8) {
          dept = tok;
        } else if (/^[가-힣]{2,5}$/.test(tok) && !name && !/^(연번|순번|부서|직급|성명|비고)$/.test(tok)) {
          name = tok;
        } else if (!name && tok.length <= 10 && !/^\d+$/.test(tok)) {
          name = tok;
        }
      }

      if (name) {
        return {
          id: 'att_' + Math.random().toString(36).substr(2, 9),
          department: dept,
          name: name.replace(/\s+/g, ''),
          position: pos,
          isSigned: false,
          signatureData: null,
          signedAt: null
        };
      }
    }

    // 3. 단일 공백으로 나뉜 경우 (예: "홍길동 교사" or "교무부 홍길동" or "홍길동")
    const spaceTokens = line.split(/\s+/).filter(Boolean);
    if (spaceTokens.length === 1) {
      const single = spaceTokens[0];
      if (/^[가-힣]{2,4}$/.test(single)) {
        return {
          id: 'att_' + Math.random().toString(36).substr(2, 9),
          department: currentDept,
          name: single,
          position: '참석자',
          isSigned: false,
          signatureData: null,
          signedAt: null
        };
      }
    } else if (spaceTokens.length <= 4) {
      let dept = currentDept;
      let name = '';
      let pos = '참석자';

      spaceTokens.forEach(token => {
        if (/^\d+$/.test(token)) return; // 번호 제외
        if (/(?:팀|부|실|과|센터)$/.test(token)) dept = token;
        else if (/^(부장|차장|과장|대리|주임|사원|팀장|실장|교사|교감|교장|수석|주무관|연구원|선임|책임)$/.test(token)) pos = token;
        else if (!name && /^[가-힣]{2,5}$/.test(token)) name = token;
      });

      if (name) {
        return {
          id: 'att_' + Math.random().toString(36).substr(2, 9),
          department: dept,
          name: name,
          position: pos,
          isSigned: false,
          signatureData: null,
          signedAt: null
        };
      }
    }

    return { isDept: false, name: null };
  }
};

window.ListParser = ListParser;
