const https = require('https');
const fs = require('fs');
const path = require('path');

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is not set.');
  process.exit(1);
}

const now = new Date();
const kstOffset = 9 * 60 * 60 * 1000;
const kstNow = new Date(now.getTime() + kstOffset);
const today = `${kstNow.getUTCFullYear()}년 ${kstNow.getUTCMonth() + 1}월 ${kstNow.getUTCDate()}일`;

console.log(`Fetching market research for ${today}...`);

const requestBody = JSON.stringify({
  model: 'claude-sonnet-4-6',
  max_tokens: 1200,
  tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  messages: [{
    role: 'user',
    content: `오늘(${today}) 기준 PC 게임과 모바일 게임 시장의 주요 이슈를 웹 검색으로 찾아 분석해줘. 반드시 JSON만 반환하고 다른 텍스트는 절대 쓰지 마. 형식: {"issues":[{"name":"이슈명(20자이내)","platform":"PC/모바일/공통","summary":"2~3문장 요약","impact":"높음|중간|낮음"}]} 이슈는 4~5개.`
  }]
});

const options = {
  hostname: 'api.anthropic.com',
  path: '/v1/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestBody),
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'web-search-2025-03-05'
  }
};

const req = https.request(options, (res) => {
  let raw = '';
  res.on('data', chunk => { raw += chunk; });
  res.on('end', () => {
    if (process.env.DEBUG === 'true') {
      console.log('Raw response:', raw.slice(0, 2000));
    }

    if (res.statusCode !== 200) {
      console.error(`API error ${res.statusCode}: ${raw.slice(0, 500)}`);
      process.exit(1);
    }

    try {
      const response = JSON.parse(raw);
      const textBlocks = response.content.filter(b => b.type === 'text');
      if (!textBlocks.length) {
        console.error('No text content in response. Content types:', response.content.map(b => b.type));
        process.exit(1);
      }

      const text = textBlocks.map(b => b.text).join('');
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (parseErr) {
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error(`Could not parse JSON from response: ${cleaned.slice(0, 200)}`);
        }
      }

      if (!parsed.issues || !Array.isArray(parsed.issues)) {
        throw new Error('Response missing "issues" array');
      }

      const output = {
        issues: parsed.issues,
        updatedAt: now.toISOString(),
        date: today
      };

      const outputPath = path.join(__dirname, '..', 'market-research.json');
      fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
      console.log(`Successfully wrote ${parsed.issues.length} issues to market-research.json`);
    } catch (err) {
      console.error('Failed to process response:', err.message);
      process.exit(1);
    }
  });
});

req.on('error', err => {
  console.error('Request failed:', err.message);
  process.exit(1);
});

req.setTimeout(30000, () => {
  console.error('Request timed out after 30s');
  req.destroy();
  process.exit(1);
});

req.write(requestBody);
req.end();
