#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <ctime>

#include <sys/stat.h>

#include <Cocoa/Cocoa.h>

#include <SPBasic.h>
#include <SPSuites.h>

#include <adobesdk/AdobesdkStringSuite.h>
#include <adobesdk/controlsurface/host/ControlSurfaceHostCommandSuite.h>
#include <adobesdk/controlsurface/host/ControlSurfaceHostSuite.h>
#include <adobesdk/controlsurface/plugin/ControlSurfacePluginSuite.h>
#include <adobesdk/controlsurface/plugin/wrapper/ControlSurfaceBase.h>
#include <adobesdk/controlsurface/plugin/wrapper/ControlSurfaceCommandBase.h>

namespace {

SPBasicSuite* gBasicSuite = 0;
SPSuitesSuite* gSuitesSuite = 0;
SPSuiteListRef gSuiteList = 0;
ADOBESDK_StringSuite1* gStringSuite = 0;

const ADOBESDK_UTF16Char kPluginID[] = {
    'P', 'R', 'F', 'X', '.', 'C', 'o', 'n', 't', 'r', 'o', 'l', 'S', 'u', 'r', 'f', 'a', 'c', 'e', 0
};
const ADOBESDK_UTF16Char kPluginName[] = {
    'P', 'R', ' ', 'F', 'X', ' ', 'C', 'o', 'n', 't', 'r', 'o', 'l', ' ', 'S', 'u', 'r', 'f', 'a', 'c', 'e', 0
};
const ADOBESDK_UTF16Char kConfigID[] = {
    'P', 'R', 'F', 'X', '.', 'C', 'o', 'n', 't', 'r', 'o', 'l', 'S', 'u', 'r', 'f', 'a', 'c', 'e', '.', 'V', '1', 0
};
const ADOBESDK_UTF16Char kUndoCommand[] = {
    'c', 'm', 'd', '.', 'e', 'd', 'i', 't', '.', 'u', 'n', 'd', 'o', 0
};
const ADOBESDK_UTF16Char kRedoCommand[] = {
    'c', 'm', 'd', '.', 'e', 'd', 'i', 't', '.', 'r', 'e', 'd', 'o', 0
};
const ADOBESDK_UTF16Char kNudgeUpCommand[] = {
    'c', 'm', 'd', '.', 't', 'i', 'm', 'e', 'l', 'i', 'n', 'e', '.', 'n', 'u', 'd', 'g', 'e', '.', 'u', 'p', 0
};

void Log(const char* message)
{
    std::ofstream logFile("/tmp/PRFXControlSurface.log", std::ios::app);
    logFile << message << "\n";
}

std::string RequestPath()
{
    const char* home = std::getenv("HOME");
    if (!home || !*home) {
        return std::string();
    }
    return std::string(home) + "/Library/Application Support/PR FX Palette/control-surface.command";
}

std::string ResponsePath()
{
    const char* home = std::getenv("HOME");
    if (!home || !*home) {
        return std::string();
    }
    return std::string(home) + "/Library/Application Support/PR FX Palette/control-surface.response";
}

void WriteResponse(const std::string& token, SPErr result)
{
    const std::string responsePath = ResponsePath();
    if (responsePath.empty()) {
        return;
    }
    std::ofstream responseFile(responsePath.c_str(), std::ios::trunc);
    responseFile << token << "|" << static_cast<long>(result) << "\n";
}

class PRFXControlSurface : public adobesdk::ControlSurfaceBase,
                           public adobesdk::ControlSurfaceCommandBase
{
public:
    PRFXControlSurface()
        : mHostRef(0), mHostSuite(0), mHostCommandSuite(0), mHostCommandRef(0), mRequestTimer(nil), mWaitingForCommandRef(false), mPendingUndoCount(0), mNextUndoAt(0)
    {
    }

    ~PRFXControlSurface()
    {
        Disconnect();
    }

    void Connect(ADOBESDK_ControlSurfaceHostRef hostRef)
    {
        Log("Connect requested");
        Disconnect();
        mHostRef = hostRef;
        AcquireHostCommandRef();
        StartRequestTimer();
    }

    void Disconnect()
    {
        StopRequestTimer();
        mHostRef = 0;
        mHostCommandRef = 0;
        mWaitingForCommandRef = false;
        mPendingUndoCount = 0;
        mNextUndoAt = 0;
        if (mHostCommandSuite) {
            gBasicSuite->ReleaseSuite(kADOBESDK_ControlSurfaceHostCommandSuite, kADOBESDK_ControlSurfaceHostCommandSuite_Version1);
            mHostCommandSuite = 0;
        }
        if (mHostSuite) {
            gBasicSuite->ReleaseSuite(kADOBESDK_ControlSurfaceHostSuite, kADOBESDK_ControlSurfaceHostSuite_Version1);
            mHostSuite = 0;
        }
    }

    ADOBESDK_ControlSurfaceRef Ref()
    {
        return reinterpret_cast<ADOBESDK_ControlSurfaceRef>(static_cast<adobesdk::ControlSurfaceBase*>(this));
    }

    SPErr GetConfigIdentifier(ADOBESDK_String* outIdentifier) const
    {
        return gStringSuite->AllocateFromUTF16(kConfigID, outIdentifier);
    }

    SPErr GetControlSurfaceFlags(uint32_t* outFlags) const
    {
        *outFlags = kADOBESDK_ControlSurfaceFlag_CanDisplayUnicode;
        return kSPNoError;
    }

    // Premiere only supplies a host command reference when the control surface
    // advertises its own command surface. The SDK sample does the same even
    // when it has no physical buttons to configure.
    SPErr GetCommandRef(ADOBESDK_ControlSurfaceCommandRef* outCommandRef)
    {
        *outCommandRef = reinterpret_cast<ADOBESDK_ControlSurfaceCommandRef>(
            static_cast<adobesdk::ControlSurfaceCommandBase*>(this));
        return kSPNoError;
    }

    SPErr Update()
    {
        return ProcessRequest();
    }

private:
    void AcquireHostCommandRef()
    {
        if (!mHostRef || mHostCommandRef) {
            return;
        }

        if (!mHostSuite) {
            if (gBasicSuite->AcquireSuite(
                    kADOBESDK_ControlSurfaceHostSuite,
                    kADOBESDK_ControlSurfaceHostSuite_Version1,
                    (const void**)&mHostSuite) != kSPNoError || !mHostSuite) {
                LogWaiting("Waiting: host suite unavailable");
                return;
            }
        }

        if (!mHostCommandSuite) {
            if (gBasicSuite->AcquireSuite(
                    kADOBESDK_ControlSurfaceHostCommandSuite,
                    kADOBESDK_ControlSurfaceHostCommandSuite_Version1,
                    (const void**)&mHostCommandSuite) != kSPNoError || !mHostCommandSuite) {
                LogWaiting("Waiting: host command suite unavailable");
                return;
            }
        }

        ADOBESDK_ControlSurfaceHostCommandRef commandRef = 0;
        if (mHostSuite->GetCommandRef(mHostRef, &commandRef) != kSPNoError || !commandRef) {
            LogWaiting("Waiting: command ref unavailable");
            return;
        }

        mHostCommandRef = commandRef;
        mWaitingForCommandRef = false;
        Log("Connect ready: command ref acquired");
    }

    void LogWaiting(const char* message)
    {
        if (!mWaitingForCommandRef) {
            Log(message);
            mWaitingForCommandRef = true;
        }
    }

    void StartRequestTimer()
    {
        if (mRequestTimer) {
            return;
        }
        // Premiere does not consistently call ControlSurface::Update() for a
        // virtual surface. An NSTimer on its UI run loop reliably keeps host
        // command execution on Premiere's main thread.
        PRFXControlSurface* surface = this;
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!surface->mRequestTimer) {
                // Premiere updates its Undo stack asynchronously for QE
                // transitions. Pace each host Undo on a separate run-loop
                // turn instead of issuing a burst that collapses to one step.
                surface->mRequestTimer = [NSTimer timerWithTimeInterval:0.12 repeats:YES block:^(NSTimer*) {
                    surface->ProcessRequest();
                }];
                [[NSRunLoop mainRunLoop] addTimer:surface->mRequestTimer forMode:NSRunLoopCommonModes];
                Log("Request timer started");
            }
        });
    }

    void StopRequestTimer()
    {
        if (mRequestTimer) {
            [mRequestTimer invalidate];
            mRequestTimer = nil;
        }
    }

    SPErr ProcessRequest()
    {
        if (!mHostCommandSuite || !mHostCommandRef) {
            AcquireHostCommandRef();
            return kSPNoError;
        }

        if (mPendingUndoCount > 0) {
            // The transition QE API updates Premiere's undo stack after it
            // returns. Calling the next Edit > Undo immediately makes the
            // host report success while repeating the same stack entry. Give
            // the stack a full UI turn before each next step.
            const CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();
            if (now < mNextUndoAt) {
                return kSPNoError;
            }
            SPErr result = Execute(kUndoCommand);
            if (result == kSPNoError) {
                --mPendingUndoCount;
                mNextUndoAt = now + 0.65;
                Log("Undo batch step completed");
                if (mPendingUndoCount == 0) {
                    Log("Undo batch completed");
                }
            } else {
                mPendingUndoCount = 0;
                Log("Undo batch failed");
            }
            return result;
        }

        const std::string requestPath = RequestPath();
        if (requestPath.empty()) {
            return kSPNoError;
        }

        // Ignore a request left behind by a previous Premiere session. A newly
        // pressed Cmd+Z is consumed by the timer within milliseconds.
        struct stat requestInfo;
        if (stat(requestPath.c_str(), &requestInfo) == 0 && std::time(0) - requestInfo.st_mtime > 15) {
            std::remove(requestPath.c_str());
            return kSPNoError;
        }

        std::ifstream requestFile(requestPath.c_str());
        std::string request;
        std::getline(requestFile, request);
        requestFile.close();
        if (request.empty()) {
            return kSPNoError;
        }

        std::remove(requestPath.c_str());
        Log("Processing control-surface request");
        if (request.compare(0, 5, "undo:") == 0) {
            const int count = std::atoi(request.substr(5).c_str());
            mPendingUndoCount += count > 0 ? count : 0;
            // Wait briefly before the first undo as well. This matters when a
            // user invokes the Function immediately after applying a QE
            // transition, before Premiere has committed its undo entry.
            if (mPendingUndoCount > 0) {
                mNextUndoAt = CFAbsoluteTimeGetCurrent() + 0.45;
            }
            Log("Undo batch queued");
            return kSPNoError;
        }
        if (request == "undo") {
            return Execute(kUndoCommand);
        }
        if (request == "redo") {
            return Execute(kRedoCommand);
        }
        if (request.compare(0, 9, "nudge-up:") == 0) {
            const std::string token = request.substr(9);
            const SPErr result = Execute(kNudgeUpCommand);
            WriteResponse(token, result);
            Log(result == kSPNoError ? "Native Timeline nudge up completed" : "Native Timeline nudge up failed");
            return result;
        }
        return kSPNoError;
    }

    SPErr Execute(const ADOBESDK_UTF16Char* commandID)
    {
        ADOBESDK_String command;
        std::memset(&command, 0, sizeof(command));
        SPErr result = gStringSuite->AllocateFromUTF16(commandID, &command);
        if (result == kSPNoError) {
            result = mHostCommandSuite->ExecuteCommand(mHostCommandRef, 0, &command);
            gStringSuite->DisposeString(&command);
        }
        return result;
    }

    ADOBESDK_ControlSurfaceHostRef mHostRef;
    ADOBESDK_ControlSurfaceHostSuite1* mHostSuite;
    ADOBESDK_ControlSurfaceHostCommandSuite1* mHostCommandSuite;
    ADOBESDK_ControlSurfaceHostCommandRef mHostCommandRef;
    NSTimer* mRequestTimer;
    bool mWaitingForCommandRef;
    int mPendingUndoCount;
    CFAbsoluteTime mNextUndoAt;
};

class PRFXControlSurfacePlugin
{
public:
    PRFXControlSurfacePlugin() : mSurface(0) {}
    ~PRFXControlSurfacePlugin() { Disconnect(); }

    ADOBESDK_ControlSurfaceRef Connect(ADOBESDK_ControlSurfaceHostRef hostRef)
    {
        mSurface = new PRFXControlSurface();
        mSurface->Connect(hostRef);
        return mSurface->Ref();
    }

    void Disconnect()
    {
        delete mSurface;
        mSurface = 0;
    }

private:
    PRFXControlSurface* mSurface;
};

SPErr Connect(ADOBESDK_ControlSurfacePluginRef pluginRef, ADOBESDK_ControlSurfaceHostRef hostRef, ADOBESDK_ControlSurfaceRef* outSurfaceRef)
{
    *outSurfaceRef = reinterpret_cast<PRFXControlSurfacePlugin*>(pluginRef)->Connect(hostRef);
    return kSPNoError;
}

SPErr Disconnect(ADOBESDK_ControlSurfacePluginRef pluginRef)
{
    reinterpret_cast<PRFXControlSurfacePlugin*>(pluginRef)->Disconnect();
    return kSPNoError;
}

SPErr GetPluginID(ADOBESDK_ControlSurfacePluginRef, ADOBESDK_String* outPluginID)
{
    return gStringSuite->AllocateFromUTF16(kPluginID, outPluginID);
}

SPErr GetPluginDisplayName(ADOBESDK_ControlSurfacePluginRef, ADOBESDK_String* outDisplayName)
{
    return gStringSuite->AllocateFromUTF16(kPluginName, outDisplayName);
}

SPErr GetPluginSettings(ADOBESDK_ControlSurfacePluginRef, ADOBESDK_String*) { return kSPUnimplementedError; }
SPErr SetPluginSettings(ADOBESDK_ControlSurfacePluginRef, const ADOBESDK_String*) { return kSPNoError; }
SPErr HasSettingsDialog(ADOBESDK_ControlSurfacePluginRef, ADOBESDK_Boolean* outHasSettings) { *outHasSettings = kAdobesdk_False; return kSPNoError; }
SPErr RunSettingsDialog(ADOBESDK_ControlSurfacePluginRef, void*, ADOBESDK_Boolean* outSettingsChanged) { *outSettingsChanged = kAdobesdk_False; return kSPNoError; }
SPErr Suspend(ADOBESDK_ControlSurfacePluginRef) { return kSPNoError; }
SPErr Resume(ADOBESDK_ControlSurfacePluginRef) { return kSPNoError; }

SPErr Startup()
{
    Log("Startup: PR FX Control Surface 2026.08.14.1");
    if (gBasicSuite->AcquireSuite(kADOBESDK_StringSuite, kADOBESDK_StringSuite_Version1, (const void**)&gStringSuite) != kSPNoError || !gStringSuite) {
        return kSPBadParameterError;
    }
    if (gBasicSuite->AcquireSuite(kSPSuitesSuite, kSPSuitesSuiteVersion, (const void**)&gSuitesSuite) != kSPNoError || !gSuitesSuite) {
        gBasicSuite->ReleaseSuite(kADOBESDK_StringSuite, kADOBESDK_StringSuite_Version1);
        gStringSuite = 0;
        return kSPBadParameterError;
    }
    if (gSuitesSuite->AllocateSuiteList(kSPRuntimeStringPool, kSPRuntimePluginList, &gSuiteList) != kSPNoError || !gSuiteList) {
        return kSPBadParameterError;
    }

    SPSuiteRef suiteRef = 0;
    static ADOBESDK_ControlSurfacePluginSuite1 pluginSuite = {
        Connect, Disconnect, GetPluginID, GetPluginDisplayName, GetPluginSettings, SetPluginSettings,
        HasSettingsDialog, RunSettingsDialog, Suspend, Resume
    };
    gSuitesSuite->AddSuite(gSuiteList, 0, kADOBESDK_ControlSurfacePluginSuite,
                           kADOBESDK_ControlSurfacePluginSuite_Version1,
                           kADOBESDK_ControlSurfacePluginSuite_Version1, &pluginSuite, &suiteRef);
    adobesdk::ControlSurfaceBase::RegisterSuite(gSuitesSuite, gSuiteList);
    adobesdk::ControlSurfaceCommandBase::RegisterSuite(gSuitesSuite, gSuiteList);
    return kSPNoError;
}

SPErr Shutdown()
{
    if (gSuiteList) {
        gSuitesSuite->FreeSuiteList(gSuiteList);
        gSuiteList = 0;
    }
    if (gSuitesSuite) {
        gBasicSuite->ReleaseSuite(kSPSuitesSuite, kSPSuitesSuiteVersion);
        gSuitesSuite = 0;
    }
    if (gStringSuite) {
        gBasicSuite->ReleaseSuite(kADOBESDK_StringSuite, kADOBESDK_StringSuite_Version1);
        gStringSuite = 0;
    }
    return kSPNoError;
}

SPErr CreatePluginInstance(ADOBESDK_ControlSurfacePluginRef* outPluginRef)
{
    *outPluginRef = reinterpret_cast<ADOBESDK_ControlSurfacePluginRef>(new PRFXControlSurfacePlugin());
    return kSPNoError;
}

SPErr DeletePluginInstance(ADOBESDK_ControlSurfacePluginRef pluginRef)
{
    delete reinterpret_cast<PRFXControlSurfacePlugin*>(pluginRef);
    return kSPNoError;
}

SPErr GetSuiteList(SPSuiteListRef* outSuiteList)
{
    *outSuiteList = gSuiteList;
    return kSPNoError;
}

ADOBESDK_ControlSurfacePluginFuncs gPluginFunctions = {
    Startup, Shutdown, CreatePluginInstance, DeletePluginInstance, GetSuiteList
};

} // namespace

extern "C" ADOBE_CONTROLSURFACE_API SPErr EntryPoint(
    SPBasicSuite* basicSuite,
    uint32_t,
    uint32_t,
    ADOBESDK_ControlSurfaceHostID,
    ADOBESDK_ControlSurfacePluginFuncs* outPluginFunctions)
{
    Log("EntryPoint");
    gBasicSuite = basicSuite;
    if (!gBasicSuite || !outPluginFunctions) {
        return kSPBadParameterError;
    }
    *outPluginFunctions = gPluginFunctions;
    return kSPNoError;
}
