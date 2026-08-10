# TTA 지출 첨부검사 배포 메모

## 현재 파일럿 패키지

- 고정 확장 ID: `lmkejmofkdcjnfcnmjgekbfippdklaco`
- TTA 적용 주소: `https://gw.tta.or.kr/*`
- 사용자 로그인 시 예약 작업이 파서와 Ollama를 숨김 상태로 자동 기동함.
- 사용자는 최초 1회 `chrome://extensions`에서 설치 경로를 로드하면 됨.
- 서명 개인키는 프로젝트·Git·OneDrive에 포함하지 않음.

## 설치

1. `scripts/install-pilot.cmd` 실행
2. 자동으로 열린 `chrome://extensions`에서 개발자 모드를 켬.
3. **압축해제된 확장 프로그램을 로드합니다**를 눌러 다음 폴더를 선택함.
   `%LOCALAPPDATA%\TTAExpenseChecker\app`
4. 표시된 확장 ID가 위 고정 ID와 같은지 확인함.

이후 로그인 때마다 서비스가 자동 시작되므로 확장 ID 입력이나 검은 창 실행은 필요 없음.

## 제거

`scripts/uninstall-pilot.ps1`을 실행한 뒤 `chrome://extensions`에서 확장을 제거함.

## 조직 배포 전 남은 작업

- Chrome Web Store 비공개 게시 또는 사내 정책 기반 강제 설치
- Node.js·Ollama·모델을 포함할지 내부 AI 서버를 사용할지 확정
- 실제 승인된 지출 증빙 규칙 탑재
- Native Messaging 전환 여부 확정
- 설치 프로그램 코드서명 및 보안 검토

개인키 위치: `C:\Users\mm704\AppData\Local\TTAExpenseChecker\signing\extension-key.pem`
운영 전 해당 키를 IT 보안 담당자가 관리하는 보안 저장소로 이관해야 함.
