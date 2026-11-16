import { describe, expect, it } from 'vitest';
import { parsePaceOptions } from './paceParser';
const words = (lines: string[]) => lines.flatMap((line, i) => line.split(' ').map((text, x) => ({ text, x: x * 100, y: i * 30, w: 80, h: 15, conf: 90, line: String(i) })));
describe('tabulka temp', () => {
  it('čte úplný řádek a nepřevádí procenta rovinek na tempo', () => {
    const result = parsePaceOptions(words(['Pacing (mins/km)', '1h40 5:30-6:00 4:40-4:50 4:20-4:30 4:10-4:20 95% Effort']), 3);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ goalTimeSec: 6000, chart: { easy: {fromSec: 330, toSec: 360}, hm_pace: {fromSec: 280, toSec: 290} }, page: 3 });
    expect(result[0].chart).not.toHaveProperty('strides');
  });
  it('přepočítá míle a opraví jen jednoznačně ztracené dvojtečky', () => {
    const result = parsePaceOptions(words(['Pacing (mins/mile)', '| 1h40 830-900 7:30-7:40 7:10-7:20 7:00-7:10']), 1);
    expect(result[0].chart.easy?.fromSec).toBe(Math.round(510 / 1.609344));
  });
  it('nepřijímá chybějící jednotky, pásmo nebo neplatné sekundy', () => {
    expect(parsePaceOptions(words(['1h40 5:30-6:00 4:40-4:50 4:20-4:30 4:10-4:20']), 1)).toEqual([]);
    expect(parsePaceOptions(words(['Pacing (mins/km)', '1h40 5:70-6:00 4:40-4:50 4:20-4:30 4:10-4:20']), 1)).toEqual([]);
  });
});
