// 마지막으로 포커스된 요소를 추적
let lastFocusedElement = null;

// 요소에 하이라이트 추가
function highlightElement(element) {
  if (lastFocusedElement) {
    lastFocusedElement.style.border = ''; // 이전 요소 하이라이트 제거
    lastFocusedElement.style.borderRadius = '';
    lastFocusedElement.style.outline = ''; // 이전 요소의 outline 제거
  }
  lastFocusedElement = element;

  // 하이라이트 스타일 적용
  element.style.border = '3px solid #F7C800';
  element.style.borderRadius = '7px';

  // 포커스 시 기본 outline 제거
  element.style.outline = 'none'; // 기본 outline 제거

  // 동적 콘텐츠를 읽도록 설정
  startObserving(element);
}

// 요소의 텍스트를 TTS로 읽기
// 텍스트가 없다면 자식 태그 순회
function findReadableText(element) {
  if (!element) return '읽을 수 있는 텍스트가 없습니다.';

  // 우선 순위: innerText > alt > title
  const text = element.innerText || element.alt || element.title;
  if (text) return text.trim();

  for (const child of element.children) {
    const childText = findReadableText(child);
    if (childText) return childText;
  }
  return '읽을 수 있는 텍스트가 없습니다.';
}

function readText(element) {
  const text =
    element.value ||
    element.innerText ||
    element.alt ||
    element.title ||
    element.placeholder ||
    element.ariaLabel; // ||
  //'읽을 수 있는 텍스트가 없습니다.';
  if (text) {
    chrome.runtime.sendMessage({ text }); // background.js에 텍스트 전송
  }
}

// 클릭 이벤트 리스너 추가
document.addEventListener('click', (event) => {
  const element = event.target;
  highlightElement(element); // 하이라이트 적용
  readText(element); // TTS로 텍스트 읽기
  const formElement = element.closest('form');

  // 폼 태그 클릭했을 때만 처리
  if (formElement) {
    const formHtml = formElement.outerHTML;

    // 폼 필드에 읽을 수 있는 값이 있는지 확인
    const hasReadableValue = Array.from(formElement.querySelectorAll('input, textarea')).some(
      (input) => {
        return input.value || input.placeholder || input.ariaLabel;
      }
    );

    // 폼 필드에 값이 없으면 백엔드로 API 호출
    if (!hasReadableValue) {
      sendFormToBackend(formHtml)
        .then((result) => {
          console.log('백엔드 응답:', result);

          // 음성 안내 메시지 전송
          chrome.runtime.sendMessage({ text: result.content });
        })
        .catch((error) => {
          console.error('API 호출 중 오류 발생:', error);

          // 오류 메시지를 음성으로 안내
          chrome.runtime.sendMessage({
            text: '폼 분석 API 호출 중 오류가 발생했습니다. 다시 시도해주세요.',
          });
        });
    } else {
      console.log('폼 필드에 읽을 수 있는 값이 있음');
    }
  }
});

// 폼 데이터를 백엔드로 전송하는 함수
async function sendFormToBackend(formHtml) {
  try {
    const formData = new FormData();
    formData.append('form_lables', formHtml);

    const response = await fetch('http://127.0.0.1:8000/api/form-labels/', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error('폼 분석 API 호출 실패');
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('백엔드 호출 중 오류 발생:', error);
    throw new Error('폼 분석 API 호출 실패');
  }
}

// Tab 키 포커스 이벤트 리스너 추가
document.addEventListener('focusin', (event) => {
  const element = event.target;
  highlightElement(element); // 하이라이트 적용
  readText(element); // TTS로 텍스트 읽기
});

// 폼 필드 입력 음성 안내
document.addEventListener('input', (event) => {
  const element = event.target;
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    chrome.runtime.sendMessage({ text: element.value }); // 입력값 TTS로 읽기
  }
});

// 동적 콘텐츠 안내
const observer = new MutationObserver((mutationsList, observer) => {
  mutationsList.forEach((mutation) => {
    if (lastFocusedElement && lastFocusedElement.contains(mutation.target)) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((addedNode) => {
          if (addedNode.nodeType === 1) {
            const text = findReadableText(addedNode);
            if (text && text !== '읽을 수 있는 텍스트가 없습니다.') {
              chrome.runtime.sendMessage({ text });
            }
          }
        });
      } else if (mutation.type === 'characterData') {
        const text = findReadableText(mutation.target);
        if (text && text !== '읽을 수 있는 텍스트가 없습니다.') {
          chrome.runtime.sendMessage({ text });
        }
      }
    }
  });
});

// 동적 콘텐츠 감지
function startObserving(element) {
  if (element) {
    observer.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
}

document.addEventListener('click', async (event) => {
  const element = event.target;

  // 이미지인지 확인
  if (element.tagName === 'IMG') {
    const altText = element.alt || element.title || '읽을 수 있는 텍스트가 없습니다.';

    if (altText === '읽을 수 있는 텍스트가 없습니다.') {
      // 대체 텍스트가 없으면 이미지를 백엔드로 전송하여 처리
      const imageURL = element.src;

      try {
        const text = await sendImageToBackend(imageURL);

        if (text) {
          console.log('백엔드 응답:', text);
          chrome.runtime.sendMessage({ text });
        } else {
          console.error('translated_caption이 생성되지 않았습니다.');
        }
      } catch (error) {
        console.error('이미지 대체 텍스트 생성 실패:', error);
        chrome.runtime.sendMessage({ text: '이미지 대체 텍스트를 생성할 수 없습니다.' }); // TTS로 안내
      }
    } else {
      chrome.runtime.sendMessage({ text: altText }); // 기존 alt 텍스트 읽기
    }
  } else {
    readText(element); // 일반 텍스트 요소 읽기
  }
});

// 이미지 URL을 백엔드로 전송하는 함수
async function sendImageToBackend(imageURL) {
  try {
    // 외부 이미지를 프록시 서버를 통해 요청
    const proxiedImageURL = `http://127.0.0.1:8000/api/proxy-image/?url=${encodeURIComponent(imageURL)}`;

    const response = await fetch(proxiedImageURL);
    const blob = await response.blob();

    const formData = new FormData();
    formData.append('image', blob, 'image.jpg');

    // 백엔드 API 호출
    const result = await fetch('http://127.0.0.1:8000/api/analyze/', {
      method: 'POST',
      body: formData,
    });

    if (!result.ok) {
      throw new Error('이미지 대체 텍스트 생성 API 호출 실패');
    }

    const data = await result.json();
    return data.translated_caption;
  } catch (error) {
    console.error('백엔드 호출 중 오류 발생:', error);
    throw new Error('이미지 대체 텍스트 생성 API 호출 실패');
  }
}

function getAPIKey() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get('ETRI_API_KEY', (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError.message);
      } else {
        resolve(result.ETRI_API_KEY);
      }
    });
  });
}
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === 'custom-shortcut-3') {
    console.log('content.js: 음성 명령 시작 메시지 수신');
    try {
      const result = await startVoiceRecognition(); // 비동기 작업
      sendResponse({ status: 'success', result });
    } catch (error) {
      sendResponse({ status: 'error', message: error.message });
    }
  }
  return true; // 비동기 응답을 위해 true 반환
});

async function startVoiceRecognition() {
  const ETRI_API_URL = 'http://aiopen.etri.re.kr:8000/WiseASR/Recognition';
  const apiKey = await getAPIKey();

  if (!apiKey) {
    console.error('ETRI API 키를 가져올 수 없습니다.');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    let audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
      const audioBuffer = await audioBlob.arrayBuffer();
      const audioBase64 = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));

      const requestJson = {
        argument: {
          language_code: 'korean',
          audio: audioBase64,
        },
      };

      const response = await fetch(ETRI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          Authorization: apiKey,
        },
        body: JSON.stringify(requestJson),
      });

      const result = await response.json();
      if (response.ok) {
        console.log('음성 인식 결과:', result.return_object.recognition_result);

        // 결과를 화면에 표시
        displayResult(result.return_object.recognition_result);
      } else {
        console.error('API 오류:', result);
      }
    };

    mediaRecorder.start();
    setTimeout(() => {
      mediaRecorder.stop();
    }, 5000); // 5초 후 녹음 종료
  } catch (error) {
    console.error('음성 인식 오류:', error);
  }
}

function displayResult(text) {
  const outputDiv = document.createElement('div');
  outputDiv.style.position = 'fixed';
  outputDiv.style.bottom = '10px';
  outputDiv.style.right = '10px';
  outputDiv.style.backgroundColor = 'white';
  outputDiv.style.padding = '10px';
  outputDiv.style.border = '1px solid black';
  document.body.appendChild(outputDiv);
  outputDiv.textContent = `인식된 텍스트: ${text}`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'custom-shortcut-1') {
    console.log('음성 명령 시작 메시지 수신');
    alert('음성 명령을 시작합니다!'); // 간단한 알림
    sendResponse({ status: 'success' });
  }
});
