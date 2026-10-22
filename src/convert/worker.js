// 투시 교정을 메인 스레드 밖에서 돌린다(GitHub Pages 버전). 입력: {data, width, height} RGBA.
import cvModule from '@techstark/opencv-js';
import { rectifyRGBA, readyCv } from './rectify.js';

let cvP = null;

self.onmessage = async (ev) => {
  const { data, width, height, mode } = ev.data;
  const post = (stage) => self.postMessage({ type: 'progress', stage });
  try {
    post('OpenCV를 불러오는 중…');
    const cv = await (cvP ??= readyCv(cvModule));
    const res = await rectifyRGBA(cv, data, width, height, post, mode);
    self.postMessage({ type: 'done', ...res }, [res.data]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
