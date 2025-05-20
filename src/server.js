/**
 * The core server that runs on a Cloudflare worker.
 */

import { AutoRouter } from 'itty-router';
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions';
import { AUTH } from './commands.js';

// Discord API 컴포넌트 타입 및 스타일 상수
const MessageComponentTypes = {
  ActionRow: 1,
  Button: 2,
  StringSelect: 3, // StringSelect는 3번 타입입니다.
  TextInput: 4,
  UserSelect: 5,
  RoleSelect: 6,
  MentionableSelect: 7,
  ChannelSelect: 8,
};
const TextInputStyle = {
  Short: 1, // 한 줄 텍스트 입력
  Paragraph: 2, // 여러 줄 텍스트 입력
};

class JsonResponse extends Response {
  constructor(body, init) {
    const jsonBody = JSON.stringify(body);
    init = init || {
      headers: {
        'content-type': 'application/json;charset=UTF-8',
      },
    };
    super(jsonBody, init);
  }
}

const router = AutoRouter();

router.get('/', (request, env) => {
  return new Response(`👋 ${env.DISCORD_APPLICATION_ID}`);
});

router.post('/', async (request, env) => {
  console.log('Interaction received:', new Date().toISOString());

  try {
    // Worker 내부에서 발생하는 모든 예외를 잡기 위한 try-catch 블록
    const { isValid, interaction } = await server.verifyDiscordRequest(
      request,
      env,
    );

    if (!isValid || !interaction) {
      console.log('Invalid request signature or no interaction.', {
        isValid,
        interaction,
      });
      return new Response('Bad request signature.', { status: 401 });
    }
    console.log('Request valid. Interaction type:', interaction.type);
    console.log('Interaction data:', JSON.stringify(interaction.data, null, 2));

    if (interaction.type === InteractionType.PING) {
      console.log('Responding with PONG.');
      return new JsonResponse({
        type: InteractionResponseType.PONG,
      });
    }

    // --- 1. 슬래시 명령어 처리 (`/인증`): 관리자만 사용, 드롭다운 포함 메시지 전송 ---
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      console.log('Handling APPLICATION_COMMAND:', interaction.data.name);
      switch (interaction.data.name.toLowerCase()) {
        case AUTH.name.toLowerCase(): {
          console.log(
            'Admin user called /인증. Sending university selection message with dropdown.',
          );
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, // 채널에 메시지 전송
            data: {
              content: '통합 마인크래프트 서버 디스코드입니다.',
              components: [
                // 메시지에 드롭다운 추가
                {
                  type: MessageComponentTypes.ActionRow,
                  components: [
                    {
                      type: MessageComponentTypes.StringSelect, // 버튼 대신 StringSelect 사용
                      custom_id: 'initial_university_select', // 드롭다운의 고유 ID
                      placeholder: '인증할 대학교를 선택해주세요.',
                      options: [
                        // 드롭다운에 표시될 옵션들
                        {
                          label: '경기과학기술대학교',
                          value: '경기과학기술대학교',
                        },
                        {
                          // '한국산업기술대학교'를 '한국공학대학교'로 변경하여 일관성 유지
                          label: '한국공학대학교',
                          value: '한국공학대학교',
                        },
                      ],
                    },
                  ],
                },
              ],
              flags: 64, // <-- 메시지를 본인에게만 보이도록 설정
            },
          });
        }
        default:
          console.error('Unknown Command:', interaction.data.name);
          return new JsonResponse(
            { error: 'Unknown Command' },
            { status: 400 },
          );
      }
    }

    // --- 2. 드롭다운 선택 상호작용 처리 (`MESSAGE_COMPONENT`): 이메일 입력 모달 표시 ---
    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
      console.log(
        'Handling MESSAGE_COMPONENT (Dropdown Select). Custom ID:',
        interaction.data.custom_id,
      );
      const customId = interaction.data.custom_id;

      let selectedUniversity = '';
      // 'initial_university_select' 드롭다운에서 선택된 경우
      if (customId === 'initial_university_select') {
        // 드롭다운의 선택된 값은 interaction.data.values 배열에 있습니다.
        selectedUniversity = interaction.data.values[0]; // 첫 번째 (단일 선택) 값을 가져옵니다.
      }

      if (selectedUniversity) {
        console.log(
          `User selected ${selectedUniversity} from dropdown. Preparing to send email modal.`,
        );
        return new JsonResponse({
          type: InteractionResponseType.MODAL, // 모달 표시
          data: {
            // 모달 custom_id에 선택된 대학교 정보를 포함하여 나중에 추출할 수 있도록 합니다.
            custom_id: `email_modal_${selectedUniversity.replace(/ /g, '_')}`, // 예: email_modal_경기과학기술대학교
            title: `${selectedUniversity} 이메일 인증`,
            components: [
              {
                type: MessageComponentTypes.ActionRow,
                components: [
                  {
                    type: MessageComponentTypes.TextInput,
                    custom_id: 'email_input', // 이메일 입력 필드 ID
                    label: '학교 이메일을 입력해주세요.',
                    style: TextInputStyle.Short,
                    required: true,
                    // 이메일 플레이스홀더를 요청에 따라 업데이트
                    placeholder: `예) 학번@${selectedUniversity === '경기과학기술대학교' ? 'office.gtec.ac.kr' : 'tukorea.ac.kr'}`,
                  },
                ],
              },
            ],
          },
        });
      }
      console.log('Unknown message component custom_id:', customId);
      // 알 수 없는 드롭다운 또는 버튼 클릭 시, 사용자에게만 보이는 임시 메시지로 응답 (타임아웃 방지)
      return new JsonResponse({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: '알 수 없는 상호작용입니다.', flags: 64 }, // flags: 64는 ephemeral (사용자만 볼 수 있음)
      });
    }

    // --- 3. 모달 제출 처리 (`MODAL_SUBMIT`): 선택된 대학교와 이메일 출력 및 UnivCert API 호출 ---
    if (interaction.type === InteractionType.MODAL_SUBMIT) {
      console.log(
        'Handling MODAL_SUBMIT. Custom ID:',
        interaction.data.custom_id,
      );
      const modalCustomId = interaction.data.custom_id;

      let selectedUniversity = '미선택';
      // 모달 custom_id에서 대학교 정보 추출
      if (modalCustomId.startsWith('email_modal_')) {
        selectedUniversity = modalCustomId
          .replace('email_modal_', '')
          .replace(/_/g, ' '); // '_'를 공백으로 되돌림
      }

      let email = '미입력';
      // 모달 컴포넌트에서 이메일 값 추출
      for (const actionRow of interaction.data.components) {
        for (const component of actionRow.components) {
          if (component.custom_id === 'email_input') {
            email = component.value;
          }
        }
      }

      console.log(
        `Modal submitted: University - ${selectedUniversity}, Email - ${email}.`,
      );

      // --- 3.1 이메일 형식 유효성 검사 ---
      let isValidEmailFormat = false;
      let expectedDomain = ''; // 이메일 형식 오류 메시지에 사용될 도메인
      if (selectedUniversity === '경기과학기술대학교') {
        expectedDomain = 'office.gtec.ac.kr';
        // 정규식: "학번@office.gtec.ac.kr" 형식 검사
        isValidEmailFormat = /^[a-zA-Z0-9._%+-]+@office\.gtec\.ac\.kr$/i.test(
          email,
        );
      } else if (selectedUniversity === '한국공학대학교') {
        expectedDomain = 'tukorea.ac.kr';
        // 정규식: "학번@tukorea.ac.kr" 형식 검사
        isValidEmailFormat = /^[a-zA-Z0-9._%+-]+@tukorea\.ac\.kr$/i.test(email);
      } else {
        // 예상치 못한 대학교 선택인 경우 (불가능에 가까움)
        isValidEmailFormat = false;
        expectedDomain = '알 수 없음';
      }

      if (!isValidEmailFormat) {
        console.log(`Email format invalid for ${selectedUniversity}: ${email}`);
        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `이메일 형식이 맞지 않습니다. **${selectedUniversity}**의 올바른 이메일 형식(예: 학번@${expectedDomain})으로 다시 입력해주세요.`,
            flags: 64, // 본인에게만 보임
          },
        });
      }

      // --- 3.2 UnivCert API 호출 ---
      // Cloudflare Worker Secret에 'UNIVCERT_API_KEY'라는 이름으로 API 키를 설정해야 합니다.
      const univcertApiKey = env.UNIVCERT_API_KEY;
      if (!univcertApiKey) {
        console.error(
          'UNIVCERT_API_KEY is not set in Cloudflare Worker secrets.',
        );
        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content:
              '봇 설정 오류: 인증 API 키가 설정되지 않았습니다. 관리자에게 문의하세요.',
            flags: 64, // 본인에게만 보임
          },
        });
      }

      const univcertPayload = {
        key: univcertApiKey,
        email: email,
        univName: selectedUniversity, // API에 전달할 대학교 이름 (예: "경기과학기술대학교", "한국공학대학교")
        univ_check: false, // 요청에 따라 false로 고정
      };

      try {
        console.log(
          'Sending request to UnivCert API:',
          JSON.stringify(univcertPayload),
        );
        const univcertResponse = await fetch(
          'https://univcert.com/api/v1/certify',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(univcertPayload),
          },
        );

        const univcertResult = await univcertResponse.json();
        console.log('UnivCert API Response:', JSON.stringify(univcertResult));

        // UnivCert API 응답 결과 처리
        if (univcertResponse.ok && univcertResult.success) {
          // API 호출 성공 및 UnivCert에서 'success: true' 반환 시
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `**인증 메일 전송 요청 완료!**\n\n**선택된 대학교:** ${selectedUniversity}\n**입력된 이메일:** ${email}\n\n**${selectedUniversity}** 이메일로 인증 메일이 전송되었습니다. 메일을 확인하고 인증을 완료해주세요!`,
              flags: 64, // 본인에게만 보임
            },
          });
        } else {
          // API 호출 실패 또는 UnivCert에서 'success: false' 반환 시
          let errorMessage = '인증 메일 전송에 실패했습니다.';
          if (univcertResult.message) {
            errorMessage += `\n오류: ${univcertResult.message}`;
          } else {
            errorMessage += `\n알 수 없는 API 응답 오류.`;
          }
          console.error('UnivCert API error:', univcertResult);
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `**인증 메일 전송 실패!**\n\n${errorMessage}\n\n잠시 후 다시 시도하거나, 이메일 주소를 다시 확인해주세요.`,
              flags: 64, // 본인에게만 보임
            },
          });
        }
      } catch (apiError) {
        // 네트워크 오류 등 API 호출 자체에서 발생한 예외 처리
        console.error('Error during UnivCert API call:', apiError);
        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content:
              '인증 서버와의 통신 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
            flags: 64, // 본인에게만 보임
          },
        });
      }
    }

    // `authentication_modal`이 아닌 다른 모달이 제출된 경우 (발생해서는 안 됨)
    console.log('Unknown modal custom_id:', interaction.data.custom_id);
    return new JsonResponse({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '알 수 없는 모달 상호작용입니다.', flags: 64 },
    });
  } catch (error) {
    // 최상위 try-catch 블록: 예상치 못한 오류를 잡고 로그 출력
    console.error('Unhandled error in router.post:', error);
    return new JsonResponse(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 },
    );
  }
});

router.all('*', () => new Response('Not Found.', { status: 404 }));

async function verifyDiscordRequest(request, env) {
  console.log('Entering verifyDiscordRequest.');
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const body = await request.text();

  console.log('Body parsed. Attempting signature verification.');
  const isValidRequest =
    signature &&
    timestamp &&
    (await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY));

  console.log('Signature verification complete. isValid:', isValidRequest);

  if (!isValidRequest) {
    return { isValid: false };
  }

  const interaction = JSON.parse(body);
  console.log(
    'Parsed interaction object:',
    JSON.stringify(interaction, null, 2),
  );

  return { interaction, isValid: true };
}

const server = {
  verifyDiscordRequest,
  fetch: router.fetch,
};

export default server;
