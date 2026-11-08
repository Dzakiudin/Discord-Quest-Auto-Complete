/**
 * ============================================================================
 * Discord Quest Auto Completer
 * ============================================================================
 * Script untuk menyelesaikan Discord Quests secara otomatis melalui DevTools Console.
 * Mendukung tipe task:
 * - WATCH_VIDEO
 * - WATCH_VIDEO_ON_MOBILE
 * - PLAY_ON_DESKTOP (Wajib menggunakan Discord Desktop App)
 * - STREAM_ON_DESKTOP (Wajib menggunakan Discord Desktop App)
 * - PLAY_ACTIVITY
 * ============================================================================
 */

// 1. Menghapus getter window.$ bawaan DevTools agar tidak bentrok
delete window.$;

// 2. Mengambil instance internal Webpack Require milik Discord (wpRequire)
//    dengan menyisipkan chunk sementara ke webpackChunkdiscord_app lalu menghapusnya kembali
let wpRequire = webpackChunkdiscord_app.push([[Symbol()], {}, r => r]);
webpackChunkdiscord_app.pop();

// 3. Mengekstrak Store & modul internal Discord dari cache Webpack (wpRequire.c)
let ApplicationStreamingStore = Object.values(wpRequire.c).find(x => x?.exports?.A?.__proto__?.getStreamerActiveStreamMetadata).exports.A;
let RunningGameStore = Object.values(wpRequire.c).find(x => x?.exports?.Ay?.getRunningGames).exports.Ay;
let QuestsStore = Object.values(wpRequire.c).find(x => x?.exports?.A?.__proto__?.getQuest).exports.A;
let ChannelStore = Object.values(wpRequire.c).find(x => x?.exports?.A?.__proto__?.getAllThreadsForParent).exports.A;
let GuildChannelStore = Object.values(wpRequire.c).find(x => x?.exports?.A?.__proto__?.getSFWDefaultChannel).exports.A;
let FluxDispatcher = Object.values(wpRequire.c).find(x => x?.exports?.h?.__proto__?.flushWaitQueue).exports.h;
let api = Object.values(wpRequire.c).find(x => x?.exports?.Bo?.get).exports.Bo;

// 4. Daftar tipe tugas (task) quest yang didukung oleh script ini
const supportedTasks = [
	"WATCH_VIDEO",
	"PLAY_ON_DESKTOP",
	"STREAM_ON_DESKTOP",
	"PLAY_ACTIVITY",
	"WATCH_VIDEO_ON_MOBILE"
];

// 5. Menyaring daftar quest yang:
//    - Sudah di-accept/enroll oleh user (enrolledAt ada)
//    - Belum selesai (completedAt masih kosong)
//    - Belum kedaluwarsa (expiresAt > waktu sekarang)
//    - Memiliki tipe task yang didukung di dalam taskConfig / taskConfigV2
let quests = [...QuestsStore.quests.values()].filter(x =>
	x.userStatus?.enrolledAt &&
	!x.userStatus?.completedAt &&
	new Date(x.config.expiresAt).getTime() > Date.now() &&
	supportedTasks.find(y => Object.keys((x.config.taskConfig ?? x.config.taskConfigV2).tasks).includes(y))
);

// Mengecek apakah dijalankan di aplikasi Discord Desktop (memiliki DiscordNative) atau Browser
let isApp = typeof DiscordNative !== "undefined";

if (quests.length === 0) {
	console.log("You don't have any uncompleted quests!");
} else {
	// 6. Fungsi rekursif antrean untuk memproses quest satu per satu
	let doJob = function() {
		const quest = quests.pop();
		if (!quest) return;

		// Membuat Process ID (PID) acak untuk simulasi proses game
		const pid = Math.floor(Math.random() * 30000) + 1000;

		const questName = quest.config.messages.questName;
		const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2;
		const taskName = supportedTasks.find(x => taskConfig.tasks[x] != null);
		const taskData = taskConfig.tasks[taskName];
		const applicationId = quest.config.application?.id ?? taskData.applications?.[0]?.id;
		const secondsNeeded = taskData.target;
		let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;

		// ====================================================================
		// MODE A: Quest Menonton Video (Desktop & Mobile)
		// ====================================================================
		if (taskName === "WATCH_VIDEO" || taskName === "WATCH_VIDEO_ON_MOBILE") {
			const speed = 7;
			const enrolledAt = new Date(quest.userStatus.enrolledAt).getTime();
			let completed = false;
			let fn = async () => {
				while (true) {
					const remaining = Math.min(speed, secondsNeeded - secondsDone);
					await new Promise(resolve => setTimeout(resolve, remaining * 1000));

					const timestamp = secondsDone + speed;
					const res = await api.post({
						url: `/quests/${quest.id}/video-progress`,
						body: { timestamp: Math.min(secondsNeeded, timestamp + Math.random()) }
					});
					completed = res.body.completed_at != null;
					secondsDone = Math.min(secondsNeeded, timestamp);

					if (timestamp >= secondsNeeded) {
						break;
					}
				}
				if (!completed) {
					await api.post({
						url: `/quests/${quest.id}/video-progress`,
						body: { timestamp: secondsNeeded }
					});
				}
				console.log("Quest completed!");
				doJob();
			};
			fn();
			console.log(`Spoofing video for ${questName}.`);

		// ====================================================================
		// MODE B: Quest Bermain Game di Desktop (PLAY_ON_DESKTOP)
		// ====================================================================
		} else if (taskName === "PLAY_ON_DESKTOP") {
			if (!isApp) {
				console.log("This no longer works in browser for non-video quests. Use the discord desktop app to complete the", questName, "quest!");
			} else {
				// Mengambil metadata publik aplikasi/game dari API Discord (nama & path executable)
				api.get({ url: `/applications/public?application_ids=${applicationId}` }).then(res => {
					const appData = res.body[0];
					const exeName = appData.executables?.find(x => x.os === "win32")?.name?.replace(">", "") ?? appData.name.replace(/[\/\\:*?"<>|]/g, "");

					// Membuat objek proses game tiruan (fakeGame)
					const fakeGame = {
						cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
						exeName,
						exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
						hidden: false,
						isLauncher: false,
						id: applicationId,
						name: appData.name,
						pid: pid,
						pidPath: [pid],
						processName: appData.name,
						start: Date.now(),
					};

					// Menyimpan referensi fungsi asli RunningGameStore lalu menggantinya (monkey-patching)
					const realGames = RunningGameStore.getRunningGames();
					const fakeGames = [fakeGame];
					const realGetRunningGames = RunningGameStore.getRunningGames;
					const realGetGameForPID = RunningGameStore.getGameForPID;
					RunningGameStore.getRunningGames = () => fakeGames;
					RunningGameStore.getGameForPID = (pid) => fakeGames.find(x => x.pid === pid);

					// Memicu event RUNNING_GAMES_CHANGE agar Discord mulai mengirim heartbeat quest
					FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: fakeGames });

					// Mendengarkan event heartbeat sukses untuk memantau progress hingga selesai
					let fn = data => {
						let progress = quest.config.configVersion === 1
							? data.userStatus.streamProgressSeconds
							: Math.floor(data.userStatus.progress.PLAY_ON_DESKTOP.value);
						console.log(`Quest progress: ${progress}/${secondsNeeded}`);

						if (progress >= secondsNeeded) {
							console.log("Quest completed!");

							// Mengembalikan fungsi RunningGameStore ke kondisi semula setelah quest selesai
							RunningGameStore.getRunningGames = realGetRunningGames;
							RunningGameStore.getGameForPID = realGetGameForPID;
							FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: [] });
							FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);

							doJob();
						}
					};
					FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);

					console.log(`Spoofed your game to ${appData.name}. Wait for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`);
				});
			}

		// ====================================================================
		// MODE C: Quest Streaming Game di Voice Channel (STREAM_ON_DESKTOP)
		// ====================================================================
		} else if (taskName === "STREAM_ON_DESKTOP") {
			if (!isApp) {
				console.log("This no longer works in browser for non-video quests. Use the discord desktop app to complete the", questName, "quest!");
			} else {
				// Mengganti metadata stream aktif agar terdeteksi sedang streaming game target
				let realFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata;
				ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
					id: applicationId,
					pid,
					sourceName: null
				});

				let fn = data => {
					let progress = quest.config.configVersion === 1
						? data.userStatus.streamProgressSeconds
						: Math.floor(data.userStatus.progress.STREAM_ON_DESKTOP.value);
					console.log(`Quest progress: ${progress}/${secondsNeeded}`);

					if (progress >= secondsNeeded) {
						console.log("Quest completed!");

						ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFunc;
						FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);

						doJob();
					}
				};
				FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);

				console.log(`Spoofed your stream to the target game. Stream any window in vc for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`);
				console.log("Remember that you need at least 1 other person to be in the vc!");
			}

		// ====================================================================
		// MODE D: Quest Discord Activity (PLAY_ACTIVITY)
		// ====================================================================
		} else if (taskName === "PLAY_ACTIVITY") {
			// Mencari ID channel suara atau DM yang tersedia untuk membuat stream_key
			const channelId = ChannelStore.getSortedPrivateChannels()[0]?.id ?? Object.values(GuildChannelStore.getAllGuilds()).find(x => x != null && x.VOCAL.length > 0).VOCAL[0].channel.id;
			const streamKey = `call:${channelId}:1`;

			let fn = async () => {
				console.log("Completing quest", questName, "-", quest.config.messages.questName);

				while (true) {
					const res = await api.post({
						url: `/quests/${quest.id}/heartbeat`,
						body: { stream_key: streamKey, terminal: false }
					});
					const progress = res.body.progress.PLAY_ACTIVITY.value;
					console.log(`Quest progress: ${progress}/${secondsNeeded}`);

					await new Promise(resolve => setTimeout(resolve, 20 * 1000));

					if (progress >= secondsNeeded) {
						await api.post({
							url: `/quests/${quest.id}/heartbeat`,
							body: { stream_key: streamKey, terminal: true }
						});
						break;
					}
				}

				console.log("Quest completed!");
				doJob();
			};
			fn();
		}
	};
	doJob();
}
