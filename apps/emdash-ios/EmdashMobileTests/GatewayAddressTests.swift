import Foundation
import Testing
@testable import EmdashMobile

struct GatewayAddressTests {
    @Test func acceptsATailnetNameWithOrWithoutScheme() throws {
        let bare = try GatewayAddress.parse("My-Mac.tail1234.ts.net:8443").get()
        #expect(bare.absoluteString == "https://my-mac.tail1234.ts.net:8443/")
        let full = try GatewayAddress.parse(" https://my-mac.tail1234.ts.net:8443/tasks?x=1 ").get()
        #expect(full.absoluteString == "https://my-mac.tail1234.ts.net:8443/")
    }

    @Test func refusesAnythingOutsideTheTailnetOrNotHTTPS() {
        #expect(GatewayAddress.parse("") == .failure(.empty))
        #expect(GatewayAddress.parse("http://my-mac.tail1234.ts.net:8443") == .failure(.notHTTPS))
        #expect(GatewayAddress.parse("https://example.com") == .failure(.notTailnet))
        #expect(GatewayAddress.parse("https://my-mac.ts.net.evil.com") == .failure(.notTailnet))
        #expect(GatewayAddress.parse("https://user:pw@my-mac.tail1234.ts.net") == .failure(.invalid))
    }

    @Test func keepsNavigationOnTheGatewayOrigin() throws {
        let gateway = try GatewayAddress.parse("my-mac.tail1234.ts.net:8443").get()
        #expect(GatewayAddress.isSameOrigin(
            URL(string: "https://my-mac.tail1234.ts.net:8443/#/task/a/b")!,
            as: gateway
        ))
        #expect(!GatewayAddress.isSameOrigin(URL(string: "https://my-mac.tail1234.ts.net/")!, as: gateway))
        #expect(!GatewayAddress.isSameOrigin(URL(string: "https://github.com/x")!, as: gateway))
    }
}
